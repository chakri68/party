import type { GameBot } from "@games/game-core";
import { bestSelection, diceToRoll, scoreDice } from "../shared/rules.ts";
import type { FarkleAction, FarklePrivateState, FarklePublicState } from "../shared/types.ts";

/** About 1 decision in this many shifts the bank threshold, as a person's mood would. */
const JITTER_ODDS = 8;
const JITTER_MAX = 150;
/** With two busts in a row and the penalty on, a person banks sooner. */
const PENALTY_CAUTION = 100;

/** Bank at this turn total or more, by how many dice are left to roll. */
function bankThreshold(diceLeft: number): number {
  if (diceLeft >= 6) return 1000; // hot dice: all six roll again, so push on
  if (diceLeft >= 4) return 500;
  if (diceLeft === 3) return 350;
  return 250;
}

/** Which dice (indices into the roll) to set aside. */
function chooseKeep(roll: readonly number[], turnTotal: number, thresholdFor: (left: number) => number): number[] {
  const best = bestSelection(roll);
  // Hot dice, or a six-dice combination: take it all.
  if (best.indices.length === roll.length) return best.indices;

  const count = (face: number) => roll.filter((f) => f === face).length;
  const at = (faces: (f: number) => boolean) => roll.map((f, i) => (faces(f) ? i : -1)).filter((i) => i >= 0);
  const worth = (indices: number[]) => scoreDice(indices.map((i) => roll[i]!));

  // Triples or better, and every 1.
  const core = at((f) => count(f) >= 3 || f === 1);
  let keep: number[];
  if (core.some((i) => count(roll[i]!) >= 3)) {
    keep = core;
    // 5s on top only when they take the turn to a bankable total.
    const withFives = at((f) => count(f) >= 3 || f === 1 || f === 5);
    const total = turnTotal + worth(withFives);
    if (withFives.length > keep.length && total >= thresholdFor(diceToRoll(roll.length, withFives.length))) keep = withFives;
  } else {
    // Only single 1s and 5s. With 4 or more dice, keep one and roll the rest.
    const singles = at((f) => f === 1 || f === 5);
    const lone = singles.find((i) => roll[i] === 1) ?? singles[0]!;
    keep = roll.length >= 4 ? [lone] : singles;
  }
  // Safety net: the game's own best choice.
  return keep.length && worth(keep) > 0 ? keep : best.indices;
}

/**
 * Farkle: keep triples and 1s (one lone scorer while there are many dice),
 * then bank once the turn total is worth the dice left. In the last round it
 * rolls until it is ahead.
 */
export const farkleBot: GameBot<FarklePublicState, FarklePrivateState, FarkleAction> = {
  decide({ playerId, public: pub }, ctx) {
    if (pub.step !== "rolled" || pub.currentPlayerId !== playerId || !pub.roll.length) return null;
    const me = pub.players.find((p) => p.id === playerId);
    if (!me) return null;

    let shift = pub.settings.threeFarkles && me.farkles === 2 ? -PENALTY_CAUTION : 0;
    if (ctx.randomInt(JITTER_ODDS) === 0) shift += ctx.randomInt(2 * JITTER_MAX + 1) - JITTER_MAX;
    const thresholdFor = (left: number) => bankThreshold(left) + shift;

    const keep = chooseKeep(pub.roll, pub.turnTotal, thresholdFor);
    const total = pub.turnTotal + scoreDice(keep.map((i) => pub.roll[i]!));
    const left = diceToRoll(pub.roll.length, keep.length);

    let bank: boolean;
    if (!me.onBoard && total < pub.settings.entry) bank = false;
    else if (me.score + total >= pub.settings.target) bank = true;
    else if (pub.finalRound && pub.finalRound.triggerId !== playerId) {
      const top = Math.max(...pub.players.filter((p) => p.id !== playerId).map((p) => p.score));
      bank = me.score + total > top;
    } else bank = total >= thresholdFor(left);

    return { type: bank ? "keep-and-bank" : "keep-and-roll", keep };
  },
};
