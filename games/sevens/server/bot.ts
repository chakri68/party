import type { GameBot } from "@games/game-core";
import { SEVEN } from "../shared/rules.ts";
import type { Card, SevensAction, SevensPrivateState, SevensPublicState } from "../shared/types.ts";

/** About 1 move in this many is any playable card, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 8;

/** How many of my other cards this one opens, and how far the farthest one is. */
function openings(card: Card, hand: readonly Card[]): { count: number; reach: number } {
  let count = 0;
  let reach = 0;
  for (const other of hand) {
    if (other.suit !== card.suit || other.id === card.id) continue;
    const ahead =
      card.rank === SEVEN ? other.rank !== SEVEN : card.rank > SEVEN ? other.rank > card.rank : other.rank < card.rank;
    if (!ahead) continue;
    count++;
    reach = Math.max(reach, Math.abs(other.rank - card.rank));
  }
  return { count, reach };
}

/**
 * Sevens: play the card that opens the most of my own cards in its suit
 * (ties: the one that reaches the farthest). It never passes while it holds
 * a playable card, so rooms with forced play off cannot stall.
 */
export const sevensBot: GameBot<SevensPublicState, SevensPrivateState, SevensAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (pub.winnerId !== null || pub.currentPlayerId !== playerId) return null;
    const playable = priv.hand.filter((c) => priv.playableCardIds.includes(c.id));
    if (!playable.length) return priv.canPass ? { type: "pass" } : null;

    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) {
      return { type: "play-card", cardId: playable[ctx.randomInt(playable.length)]!.id };
    }
    let best = playable[0]!;
    let bestScore = openings(best, priv.hand);
    for (const card of playable.slice(1)) {
      const s = openings(card, priv.hand);
      if (s.count > bestScore.count || (s.count === bestScore.count && s.reach > bestScore.reach)) {
        best = card;
        bestScore = s;
      }
    }
    return { type: "play-card", cardId: best.id };
  },
};
