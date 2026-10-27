// What's left to play on each letter. Server only, like the dictionary itself.

import { allWords } from "@games/words/dictionary";

let byLetter: Map<string, number> | null = null;

/**
 * Dictionary words starting with `letter`, minus the ones in `used`. Every
 * dictionary word is already a–z and 3+ letters, so that's exactly what's
 * still playable. The counts are made once; `allWords()` is shared, read only.
 */
export function wordsOn(letter: string, used: readonly string[]): number {
  if (!byLetter) {
    byLetter = new Map();
    for (const w of allWords()) byLetter.set(w[0]!, (byLetter.get(w[0]!) ?? 0) + 1);
  }
  return (byLetter.get(letter) ?? 0) - used.filter((w) => w[0] === letter).length;
}

export const LETTERS = "abcdefghijklmnopqrstuvwxyz";
