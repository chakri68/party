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
 * How every option looks on the board, the real one too: straight quotes,
 * lowercase first letter, no trailing full stop, "!", "?" or ellipsis.
 * Capitals, curly quotes and end punctuation are a tell: phones type them,
 * the real list doesn't.
 */
export function displayDefinition(text: string): string {
  const t = text
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201C\u201D]/gu, '"')
    .trim()
    .replace(/[.!?\u2026\s]+$/u, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Words of three letters or more, lowercased, for the overlap check. */
function wordSet(text: string): Set<string> {
  return new Set(
    displayDefinition(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
}

/** Below this many letters, one text sitting inside another means nothing. */
const MIN_CONTAINED = 12;
/** Shared words over all words (3+ letters) at which two meanings are one. */
const MAX_OVERLAP = 0.7;

/**
 * Two definitions that are really one. Any of:
 * - equal once normalised, or a few letters apart for their length (15%, at
 *   least 2): a retyped meaning, or a word misspelt;
 * - one inside the other, once normalised: a meaning with a bit cut off or
 *   tacked on;
 * - 70% or more of their words (3+ letters) shared: a word or two swapped.
 * A different bluff gets through.
 */
export function nearSame(a: string, b: string): boolean {
  const x = normalizeGuess(displayDefinition(a));
  const y = normalizeGuess(displayDefinition(b));
  if (x === y) return true;
  const limit = Math.max(2, Math.floor(Math.min(x.length, y.length) * 0.15));
  if (editDistance(x, y, limit) <= limit) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= MIN_CONTAINED && long.includes(short)) return true;
  const wa = wordSet(a);
  const wb = wordSet(b);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const union = wa.size + wb.size - shared;
  return union > 0 && shared / union >= MAX_OVERLAP;
}
