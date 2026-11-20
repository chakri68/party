import type { GameBot } from "@games/game-core";
import { countMatches, isLegalBid, minQuantity, onesAreWild, skipBid } from "../shared/rules.ts";
import { FACES, type Face, type LiarsDiceAction, type LiarsDicePrivateState, type LiarsDicePublicState } from "../shared/types.ts";

/** About 1 move in this many is any legal move, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 10;
/** A bot calls Liar when the bid is less likely than a limit between these, in percent. */
const CALL_LIMIT_LOW = 25;
const CALL_LIMIT_SPAN = 15;
/** A raise less likely than this is not worth making. */
const RAISE_FLOOR = 0.4;
/** Spot on needs this chance of an exact count, and then a 1-in-4 roll. */
const SPOT_ON_FLOOR = 0.3;
const SPOT_ON_ODDS = 4;
/** About 1 raise in this many is a small bluff. */
const BLUFF_ODDS = 5;

/** Chance that `n` dice each showing the face with chance `p` give at least `need`, and exactly `need`. */
function odds(n: number, p: number, need: number): { atLeast: number; exact: number } {
  if (need <= 0) return { atLeast: 1, exact: need === 0 ? (1 - p) ** n : 0 };
  if (need > n) return { atLeast: 0, exact: 0 };
  // pmf[k] built up one die at a time: at most 40 dice, so this is tiny.
  let pmf = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(pmf.length + 1).fill(0);
    for (let k = 0; k < pmf.length; k++) {
      next[k]! += pmf[k]! * (1 - p);
      next[k + 1]! += pmf[k]! * p;
    }
    pmf = next;
  }
  let atLeast = 0;
  for (let k = need; k <= n; k++) atLeast += pmf[k]!;
  return { atLeast, exact: pmf[need]! };
}

/**
 * Liar's Dice: weigh each bid by the dice in the bot's own cup and the share
 * it expects under the other cups. Call Liar on a bid that looks too high,
 * else raise on the face it holds most of, with an odd bluff and slip.
 */
export const liarsDiceBot: GameBot<LiarsDicePublicState, LiarsDicePrivateState, LiarsDiceAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (priv.canReady) return { type: "ready" };
    if (pub.phase !== "bidding" || pub.currentPlayerId !== playerId) return null;

    const { wildOnes } = pub.settings;
    const total = pub.totalDice;
    const unknown = Math.max(0, total - priv.dice.length);
    const prev = pub.bid;
    const legal = (quantity: number, face: Face) => isLegalBid(prev, { quantity, face }, wildOnes, total);
    const chanceOf = (face: Face) => (onesAreWild(face, wildOnes) ? 1 / 3 : 1 / 6);
    const mine = (face: Face) => countMatches(priv.dice, face, wildOnes);
    const expected = (face: Face) => mine(face) + chanceOf(face) * unknown;
    const trueOdds = (quantity: number, face: Face) => odds(unknown, chanceOf(face), quantity - mine(face));

    // Every legal bid, cheapest first on each face.
    const raises: { quantity: number; face: Face }[] = [];
    for (const face of FACES) {
      const quantity = minQuantity(prev, face, wildOnes);
      if (legal(quantity, face)) raises.push({ quantity, face });
    }

    const slip = ctx.randomInt(RANDOM_MOVE_ODDS) === 0;
    const callable = !!prev && priv.canCallLiar;

    if (slip) {
      const moves: LiarsDiceAction[] = raises.map((b) => ({ type: "bid", quantity: b.quantity, face: b.face }));
      if (callable) moves.push({ type: "liar" });
      if (prev && priv.canSpotOn) moves.push({ type: "spot-on" });
      if (moves.length) return moves[ctx.randomInt(moves.length)]!;
    }

    // The face with the best count; ties go high. Not 1s when they are wild.
    const bestFace = (): Face => {
      let best: Face = 6;
      for (const face of [5, 4, 3, 2, 1] as Face[]) {
        if (face === 1 && wildOnes) continue;
        if (expected(face) > expected(best)) best = face;
      }
      return best;
    };

    if (!prev) {
      const face = bestFace();
      const quantity = Math.max(1, Math.min(total, Math.round(expected(face)) - 1));
      if (legal(quantity, face)) return { type: "bid", quantity, face };
      const fallback = skipBid(priv.dice, null, wildOnes, total);
      return fallback ? { type: "bid", ...fallback } : null;
    }

    const standing = trueOdds(prev.quantity, prev.face);
    if (priv.canSpotOn && standing.exact >= SPOT_ON_FLOOR && ctx.randomInt(SPOT_ON_ODDS) === 0) return { type: "spot-on" };
    const limit = (CALL_LIMIT_LOW + ctx.randomInt(CALL_LIMIT_SPAN + 1)) / 100;
    if (callable && (standing.atLeast < limit || !raises.length)) return { type: "liar" };

    // Raise on the face held most, at its least quantity.
    const ranked = [...raises].sort((a, b) => expected(b.face) - expected(a.face) || a.quantity - b.quantity);
    const best = ranked[0];
    if (best && trueOdds(best.quantity, best.face).atLeast >= RAISE_FLOOR) {
      // Now and then, a small bluff: another face, only slightly above what is expected.
      if (ctx.randomInt(BLUFF_ODDS) === 0) {
        const bluffs = raises.filter((b) => b.face !== best.face && b.quantity <= expected(b.face) + 1);
        if (bluffs.length) {
          const b = bluffs[ctx.randomInt(bluffs.length)]!;
          return { type: "bid", quantity: b.quantity, face: b.face };
        }
      }
      return { type: "bid", quantity: best.quantity, face: best.face };
    }
    // The best bid is weak: the cheapest one with better odds, else call.
    const better = raises
      .map((b) => ({ b, p: trueOdds(b.quantity, b.face).atLeast }))
      .filter((x) => x.p >= RAISE_FLOOR)
      .sort((a, b) => a.b.quantity - b.b.quantity || b.p - a.p)[0];
    if (better) return { type: "bid", quantity: better.b.quantity, face: better.b.face };
    if (callable) return { type: "liar" };
    const fallback = skipBid(priv.dice, prev, wildOnes, total);
    return fallback ? { type: "bid", ...fallback } : null;
  },
};
