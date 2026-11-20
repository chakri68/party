import type { GameBot } from "@games/game-core";
import type {
  AskRecord,
  GoFishAction,
  GoFishPrivateState,
  GoFishPublicState,
  Rank,
} from "../shared/types.ts";

/** About 1 turn in this many ignores the table's memory, as a forgetful person would. */
const FORGET_ODDS = 4;

/** `playerId` asked for `rank` at position `index`, and nobody took those cards from them since. */
function stillHolds(asks: readonly AskRecord[], index: number): boolean {
  const ask = asks[index]!;
  return !asks.slice(index + 1).some((a) => a.targetId === ask.playerId && a.rank === ask.rank && a.got > 0);
}

/** `targetId` said "go fish" for `rank`, and has not asked for it since. */
function knownToLack(asks: readonly AskRecord[], targetId: string, rank: Rank): boolean {
  for (let i = asks.length - 1; i >= 0; i--) {
    const a = asks[i]!;
    if (a.rank !== rank) continue;
    if (a.playerId === targetId) return false;
    if (a.targetId === targetId && a.got === 0) return true;
  }
  return false;
}

function pick<T>(items: readonly T[], ctx: { randomInt(max: number): number }): T {
  return items[ctx.randomInt(items.length)]!;
}

/**
 * Go Fish: ask whoever lately asked for a rank I hold; else ask for the rank I
 * hold most of, from someone not known to lack it. Now and then it forgets all that.
 */
export const goFishBot: GameBot<GoFishPublicState, GoFishPrivateState, GoFishAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (pub.currentPlayerId !== playerId) return null;
    const ranks = priv.askableRanks;
    const targets = pub.players.filter((p) => p.id !== playerId && !p.removed && p.cardCount > 0).map((p) => p.id);
    if (!ranks.length || !targets.length) return null;

    if (ctx.randomInt(FORGET_ODDS) === 0) {
      return { type: "ask", targetId: pick(targets, ctx), rank: pick(ranks, ctx) };
    }

    const asks = pub.asks;
    for (let i = asks.length - 1; i >= 0; i--) {
      const a = asks[i]!;
      if (a.playerId === playerId || !targets.includes(a.playerId) || !ranks.includes(a.rank)) continue;
      if (stillHolds(asks, i)) return { type: "ask", targetId: a.playerId, rank: a.rank };
    }

    const counts = new Map<Rank, number>();
    for (const c of priv.hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    const most = Math.max(...ranks.map((r) => counts.get(r) ?? 0));
    const rank = pick(ranks.filter((r) => (counts.get(r) ?? 0) === most), ctx);
    const open = targets.filter((t) => !knownToLack(asks, t, rank));
    return { type: "ask", targetId: pick(open.length ? open : targets, ctx), rank };
  },
};
