import type { GameBot } from "@games/game-core";
import { beats, trickWinnerIndex } from "../shared/tricks.ts";
import type { Card, OhHellAction, OhHellPrivateState, OhHellPublicState } from "../shared/types.ts";

/** About 1 play in this many is any legal card, as a person's slip would be. */
const RANDOM_PLAY_ODDS = 10;
/** Queens and up are worth a trick when they are trump. */
const HIGH_TRUMP = 12;
/** With a hand this small, any trump may win a trick. */
const SMALL_HAND = 3;
const ACE = 14;
const KING = 13;

/** How many tricks the hand is likely to win, as a person would count them. */
function expectedTricks(hand: readonly Card[], trump: string, handSize: number): number {
  let sum = 0;
  for (const c of hand) {
    if (c.suit === trump) {
      if (c.rank >= HIGH_TRUMP || handSize <= SMALL_HAND) sum += 1;
    } else if (c.rank === ACE) sum += 1;
    else if (c.rank === KING && hand.filter((o) => o.suit === c.suit).length >= 2) sum += 0.5;
  }
  return Math.round(sum);
}

/**
 * Oh Hell: bid the tricks the hand looks good for, stepping off the number the
 * dealer can't say. Play to win while short of the bid, and to lose once it is made.
 */
export const ohHellBot: GameBot<OhHellPublicState, OhHellPrivateState, OhHellAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (priv.canReady) return { type: "ready" };

    if (priv.canBid) {
      let bid = Math.max(0, Math.min(pub.handSize, expectedTricks(priv.hand, pub.trump.suit, pub.handSize)));
      if (bid === pub.forbiddenBid) bid = bid > 0 ? bid - 1 : bid + 1;
      return { type: "bid", tricks: bid };
    }

    if (pub.phase !== "playing" || pub.currentPlayerId !== playerId || !priv.legal.length) return null;
    const legal = priv.hand.filter((c) => priv.legal.includes(c.id));
    if (!legal.length) return null;
    if (ctx.randomInt(RANDOM_PLAY_ODDS) === 0) return { type: "play", card: legal[ctx.randomInt(legal.length)]!.id };

    const me = pub.players.find((p) => p.id === playerId);
    if (!me || me.bid === null) return { type: "play", card: legal[0]!.id };
    const trump = pub.trump.suit;
    // Low to high, with trump above every other suit.
    const strength = (c: Card) => (c.suit === trump ? 100 : 0) + c.rank;
    const sorted = [...legal].sort((a, b) => strength(a) - strength(b));
    const lowest = sorted[0]!;
    const highest = sorted[sorted.length - 1]!;
    const needMore = me.tricks < me.bid;

    if (!pub.trick.length) {
      // Leading. To win, lead the best card. To lose, lead the weakest.
      return { type: "play", card: (needMore ? highest : lowest).id };
    }
    const led = pub.trick[0]!.card.suit;
    const winning = pub.trick[trickWinnerIndex(pub.trick.map((t) => t.card), trump)]!.card;
    const wins = sorted.filter((c) => beats(c, winning, led, trump));
    if (needMore) return { type: "play", card: (wins[0] ?? lowest).id };
    const loses = sorted.filter((c) => !wins.includes(c));
    return { type: "play", card: (loses[loses.length - 1] ?? highest).id };
  },
};
