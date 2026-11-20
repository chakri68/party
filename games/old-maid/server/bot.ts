import type { GameBot } from "@games/game-core";
import type { OldMaidAction, OldMaidPrivateState, OldMaidPublicState } from "../shared/types.ts";

/** 1 pick in this many goes straight to an end slot; the rest are any slot. */
const END_SLOT_ODDS = 3;

/**
 * Old Maid has no choice that helps: the fan is reshuffled after every card.
 * The bot takes a random slot, and now and then an end one.
 */
export const oldMaidBot: GameBot<OldMaidPublicState, OldMaidPrivateState, OldMaidAction> = {
  decide({ playerId, public: pub }, ctx) {
    if (pub.currentPlayerId !== playerId) return null;
    const count = pub.players.find((p) => p.id === pub.sourceId)?.cardCount ?? 0;
    if (count <= 0) return null;
    if (ctx.randomInt(END_SLOT_ODDS) === 0) return { type: "take", slot: ctx.randomInt(2) === 0 ? 0 : count - 1 };
    return { type: "take", slot: ctx.randomInt(count) };
  },
};
