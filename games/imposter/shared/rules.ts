import { cleanChatText } from "@games/protocol";
import { isClose, normalizeGuess } from "@games/words";
import { MAX_CLUE, MAX_GUESS } from "./types.ts";

export { normalizeGuess };

/** A clue as the server keeps it: one line, no control characters, 40 at most. */
export const cleanClue = (text: string): string => cleanChatText(text, MAX_CLUE);
export const cleanGuess = (text: string): string => cleanChatText(text, MAX_GUESS);

/**
 * Why an innocent's clue can't go up, or null. Shared so their screen can say
 * so without a round trip. Never run for the Imposter: a rejection would tell
 * them the word.
 */
export function clueProblem(clue: string, word: string): string | null {
  if (!clue) return "Type a clue.";
  const w = normalizeGuess(word);
  if (w && normalizeGuess(clue).includes(w)) return "That is the word. Write a different clue.";
  return null;
}

/**
 * The Imposter's last guess. Exact once normalised, give or take a plural: one
 * letter off between real words is usually a different word (lamp, camp), so
 * that's only `close`, a consolation line.
 */
export function guessMatches(guess: string, word: string): { right: boolean; close: boolean } {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  if (!g) return { right: false, close: false };
  const plural = (a: string, b: string) => a === `${b}s` || a === `${b}es`;
  const right = g === w || plural(g, w) || plural(w, g);
  return { right, close: !right && isClose(g, w) };
}
