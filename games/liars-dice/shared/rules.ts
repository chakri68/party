import type { Face } from "./types.ts";

type BidLike = { quantity: number; face: Face };

// ---------------------------------------------------------------------------
// The raise ladder
// ---------------------------------------------------------------------------

/**
 * The least quantity of `face` that beats `prev`, ignoring the table's size.
 * Without wilds it's the usual ladder: same quantity needs a higher face.
 * With wilds, 1s are their own ladder: half (rounded up) to get onto them,
 * double plus one to get off, and "same quantity, higher face" never crosses.
 */
export function minQuantity(prev: BidLike | null, face: Face, wildOnes: boolean): number {
  if (!prev) return 1;
  const { quantity: q, face: f } = prev;
  if (wildOnes && (face === 1 || f === 1)) {
    if (face === 1 && f === 1) return q + 1;
    if (face === 1) return Math.ceil(q / 2);
    return 2 * q + 1;
  }
  return face > f ? q : q + 1;
}

/** A legal bid after `prev`: in range for the table, and strictly higher. */
export function isLegalBid(prev: BidLike | null, next: BidLike, wildOnes: boolean, totalDice: number): boolean {
  if (!Number.isInteger(next.quantity) || next.quantity < 1 || next.quantity > totalDice) return false;
  return next.quantity >= minQuantity(prev, next.face, wildOnes);
}

/**
 * The smallest step up: the next face at the same quantity, else one more of
 * the lowest face. 1s are skipped with wilds on (they're their own ladder),
 * unless the bid is already on 1s, where one more 1 is the small step. Null
 * when nothing beats it on this table.
 */
export function smallestRaise(prev: BidLike | null, wildOnes: boolean, totalDice: number, opening: Face = 2): BidLike | null {
  if (!prev) return totalDice >= 1 ? { quantity: 1, face: opening } : null;
  const low: Face = wildOnes ? 2 : 1;
  let step: BidLike;
  if (wildOnes && prev.face === 1) step = { quantity: prev.quantity + 1, face: 1 };
  else if (prev.face < 6) step = { quantity: prev.quantity, face: (prev.face + 1) as Face };
  else step = { quantity: prev.quantity + 1, face: low };
  if (isLegalBid(prev, step, wildOnes, totalDice)) return step;
  // Off the top of the table: whatever's still legal, fewest dice first.
  const options = ([1, 2, 3, 4, 5, 6] as Face[])
    .map((face) => ({ face, quantity: minQuantity(prev, face, wildOnes) }))
    .filter((b) => b.quantity <= totalDice)
    .sort((a, b) => a.quantity - b.quantity || b.face - a.face);
  return options[0] ?? null;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** Do 1s count toward a bid on `face`? Only with wilds on, and never for a bid on 1s. */
export function onesAreWild(face: Face, wildOnes: boolean): boolean {
  return wildOnes && face !== 1;
}

export function matches(die: Face, face: Face, wildOnes: boolean): boolean {
  return die === face || (die === 1 && onesAreWild(face, wildOnes));
}

export function countMatches(dice: readonly Face[], face: Face, wildOnes: boolean): number {
  return dice.filter((d) => matches(d, face, wildOnes)).length;
}

/**
 * What an idle player's skip bids for them: the face they hold most of (wilds
 * included; ties to the higher face). Opening, one of it. Otherwise the least
 * raise on that face, or failing that the least raise at all.
 */
export function skipBid(dice: readonly Face[], prev: BidLike | null, wildOnes: boolean, totalDice: number): BidLike | null {
  let best: Face = 6;
  let most = -1;
  for (const face of [6, 5, 4, 3, 2, 1] as Face[]) {
    const n = countMatches(dice, face, wildOnes);
    if (n > most) {
      most = n;
      best = face;
    }
  }
  if (!prev) return { quantity: 1, face: best };
  const q = minQuantity(prev, best, wildOnes);
  if (q <= totalDice) return { quantity: q, face: best };
  return smallestRaise(prev, wildOnes, totalDice);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "one 3", "four 3s", "two 1s". */
export function bidText(quantity: number, face: Face): string {
  return `${numberWord(quantity)} ${face}${quantity === 1 ? "" : "s"}`;
}

/** "1st", "2nd", "3rd", "4th". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
