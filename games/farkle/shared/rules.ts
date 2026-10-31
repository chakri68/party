import { DICE } from "./types.ts";

// ---------------------------------------------------------------------------
// Scoring. Shared so the client scores a selection with the same code the
// server checks it with.
// ---------------------------------------------------------------------------

/** Three of a kind: 1s are 1,000, anything else face × 100. */
export function tripleValue(face: number): number {
  return face === 1 ? 1000 : face * 100;
}

const memo = new Map<string, number>();

/**
 * The best score that uses every die counted, or -1 when some die can't be
 * part of any combination. `counts[f]` is how many show face f (index 0 unused).
 */
function bestUsingAll(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const key = counts.join("");
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  let best = -1;
  const take = (points: number, face: number, n: number) => {
    counts[face]! -= n;
    const rest = bestUsingAll(counts);
    counts[face]! += n;
    if (rest >= 0) best = Math.max(best, points + rest);
  };

  // Six-dice combinations use the whole lot.
  if (total === 6) {
    const faces = counts.slice(1);
    if (faces.every((c) => c === 1)) best = Math.max(best, 1500);
    if (faces.every((c) => c % 2 === 0)) best = Math.max(best, 1500); // three pairs; 4+2 counts
    if (faces.filter((c) => c === 3).length === 2) best = Math.max(best, 2500);
  }
  for (let f = 1; f <= 6; f++) {
    const c = counts[f]!;
    if (!c) continue;
    if (f === 1) take(100, 1, 1);
    if (f === 5) take(50, 5, 1);
    if (c >= 3) take(tripleValue(f), f, 3);
    if (c >= 4) take(1000, f, 4);
    if (c >= 5) take(2000, f, 5);
    if (c >= 6) take(3000, f, 6);
  }
  memo.set(key, best);
  return best;
}

function countFaces(faces: readonly number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const f of faces) counts[f]!++;
  return counts;
}

/**
 * What these dice score as a selection, split into combinations the best
 * way. 0 when nothing's selected or any die doesn't score: such a selection
 * isn't legal.
 */
export function scoreDice(faces: readonly number[]): number {
  if (!faces.length || faces.some((f) => !Number.isInteger(f) || f < 1 || f > 6)) return 0;
  return Math.max(0, bestUsingAll(countFaces(faces)));
}

/** Every non-empty subset of `n` indices, as bit masks. */
function* masks(n: number): Generator<number[]> {
  for (let m = 1; m < 1 << n; m++) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) out.push(i);
    yield out;
  }
}

/**
 * The highest-scoring legal selection from a roll. Ties go to fewer dice,
 * which leaves more to roll. `points: 0` means the roll busted.
 */
export function bestSelection(roll: readonly number[]): { indices: number[]; points: number } {
  let best = { indices: [] as number[], points: 0 };
  for (const indices of masks(roll.length)) {
    const points = scoreDice(indices.map((i) => roll[i]!));
    if (points > best.points || (points === best.points && points > 0 && indices.length < best.indices.length)) {
      best = { indices, points };
    }
  }
  return best;
}

/** A farkle: nothing in the roll scores. */
export function isFarkle(roll: readonly number[]): boolean {
  return bestSelection(roll).points === 0;
}

/**
 * Positions (into `faces`) of dice that can't score in any part of this
 * selection: "that 3 doesn't score". Empty for a legal selection.
 */
export function deadDice(faces: readonly number[]): number[] {
  if (scoreDice(faces) > 0) return [];
  const alive = new Set<number>();
  for (const indices of masks(faces.length)) {
    if (scoreDice(indices.map((i) => faces[i]!)) > 0) for (const i of indices) alive.add(i);
  }
  return faces.map((_, i) => i).filter((i) => !alive.has(i));
}

/** How many dice the next roll gets after keeping `keeping` of `rolled`: all six again on hot dice. */
export function diceToRoll(rolled: number, keeping: number): number {
  return rolled - keeping || DICE;
}

/** "1,500". */
export function formatPoints(n: number): string {
  return n.toLocaleString("en-US");
}
