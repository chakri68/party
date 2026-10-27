/** Levenshtein distance, stopping early once it's past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** One typo off, on a word long enough that one typo isn't half of it. */
export function isClose(guess: string, word: string): boolean {
  return word.length >= 4 && guess !== word && editDistance(guess, word, 1) === 1;
}

/**
 * What a guess is compared as: no accents, no case, letters and digits only.
 * "Ice-cream", "ice cream" and "icecream" are all the same guess.
 */
export function normalizeGuess(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
