import { MAX_WORD, MIN_WORD, type TypingData } from "./types.ts";

/** What a typed word is compared as: trimmed, lowercase. Anything but a–z left in makes it not a word. */
export function normalizeWord(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Why a word can't count before anyone opens the dictionary, or null if it
 * might. Shared so the holder's screen can shake without a round trip.
 */
export function shapeProblem(word: string, cluster: string): string | null {
  if (!/^[a-z]+$/.test(word)) return "Letters only.";
  if (word.length < MIN_WORD) return `${MIN_WORD} letters at least.`;
  if (word.length > MAX_WORD) return "That's not a word.";
  if (!word.includes(cluster)) return `It needs ${cluster.toUpperCase()} in it.`;
  return null;
}

/** Untrusted typing off the stream → clean, or null. */
export function parseTyping(input: unknown): TypingData | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (!Number.isInteger(o.turn) || typeof o.text !== "string" || o.text.length > 200) return null;
  const turn = o.turn as number;
  const text = o.text.toLowerCase().replace(/[^a-z]/g, "").slice(0, MAX_WORD);
  return o.wrong === true ? { turn, text, wrong: true } : { turn, text };
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
