import { MAX_WORD, MIN_WORD } from "@games/pass-the-bomb/shared";

// The Bomb's typed-word helpers do the same job here: trim and lowercase, and
// clean whatever comes off the typing stream.
export { normalizeWord, ordinal, parseTyping, type TypingData } from "@games/pass-the-bomb/shared";
export { MAX_WORD, MIN_WORD };

/**
 * Why a word can't count before anyone opens the dictionary, or null if it
 * might. Shared so the holder's screen can shake without a round trip.
 */
export function shapeProblem(word: string, letter: string): string | null {
  if (!/^[a-z]+$/.test(word)) return "Letters only.";
  if (word.length < MIN_WORD) return `${MIN_WORD} letters at least.`;
  if (word.length > MAX_WORD) return "That's not a word.";
  if (!word.startsWith(letter)) return `It has to start with ${letter.toUpperCase()}.`;
  return null;
}

export const lastLetter = (word: string): string => word.at(-1)!;
