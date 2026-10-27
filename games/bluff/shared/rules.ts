import { cleanChatText } from "@games/protocol";
import { editDistance, normalizeGuess } from "@games/words";
import { MAX_DEFINITION, MAX_FAKE, MIN_DEFINITION, MIN_FAKE } from "./types.ts";

// Client-safe checks, shared so a phone can say what's wrong without a round
// trip. The dictionary and the real answer stay on the server: those checks
// live in server/game.ts.

/** A fake word as the server keeps it: trimmed, lowercase. */
export const cleanFake = (text: string): string => text.trim().toLowerCase();

/** Why a fake word can't go in, judging by its shape alone, or null. */
export function fakeShapeProblem(word: string): string | null {
  if (!word) return "Type a word.";
  if (!/^[a-z]+$/.test(word)) return "Letters only, a to z.";
  if (word.length < MIN_FAKE) return `At least ${MIN_FAKE} letters.`;
  if (word.length > MAX_FAKE) return `${MAX_FAKE} letters at most.`;
  return null;
}

/** A definition as the server keeps it: one line, no control characters, 180 at most. */
export const cleanDefinition = (text: string): string => cleanChatText(text, MAX_DEFINITION);

export function definitionShapeProblem(text: string): string | null {
  if (!text) return "Type a meaning.";
  if ([...text].length < MIN_DEFINITION) return `At least ${MIN_DEFINITION} characters.`;
  return null;
}

/**
 * How every option looks on the board, the real one too: lowercase first
 * letter, no trailing full stop. Capitals and full stops are a tell.
 */
export function displayDefinition(text: string): string {
  const t = text.trim().replace(/[.\s]+$/u, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * Two definitions that are really one: equal once normalised, or a few
 * letters apart for their length (15%, at least 2). Catches a retyped
 * meaning, or one with a word swapped; a different bluff gets through.
 */
export function nearSame(a: string, b: string): boolean {
  const x = normalizeGuess(displayDefinition(a));
  const y = normalizeGuess(displayDefinition(b));
  if (x === y) return true;
  const limit = Math.max(2, Math.floor(Math.min(x.length, y.length) * 0.15));
  return editDistance(x, y, limit) <= limit;
}
