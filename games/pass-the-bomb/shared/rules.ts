import { LENGTH_MAX, LENGTH_MIN, MAX_WORD, MIN_WORD, MODE_KEYS, NO_MODES, type BombModes, type TypingData } from "./types.ts";

/** What a typed word is compared as: trimmed, lowercase. Anything but a–z left in makes it not a word. */
export function normalizeWord(text: string): string {
  return text.trim().toLowerCase();
}

/** The modes out of a settings object (or anything shaped like one). */
export function modesOf(settings: Partial<BombModes> | null | undefined): BombModes {
  return Object.fromEntries(MODE_KEYS.map((k) => [k, settings?.[k] === true])) as unknown as BombModes;
}

/**
 * What the bomb shows → what the word needs. The one place REVERSE means
 * anything: today it's the letters backwards (source §4.2's reading). To make
 * it mean something else, change this and displayCluster, and nothing else.
 */
export function effectiveCluster(display: string, modes: BombModes): string {
  return modes.reverse ? [...display].reverse().join("") : display;
}

/** What effectiveCluster's inverse puts on the bomb. Backwards is its own inverse. */
export function displayCluster(cluster: string, modes: BombModes): string {
  return effectiveCluster(cluster, modes);
}

/**
 * Why a word can't count before anyone opens the dictionary, or null if it
 * might. `cluster` is the effective one. Shared so the holder's screen can
 * shake without a round trip. Everything here is objective: no vote overrides it.
 */
export function shapeProblem(word: string, cluster: string, modes: BombModes = NO_MODES): string | null {
  if (!/^[a-z]+$/.test(word)) return "Letters only.";
  if (word.length < MIN_WORD) return `${MIN_WORD} letters at least.`;
  if (word.length > MAX_WORD) return "That's not a word.";
  if (modes.length && (word.length < LENGTH_MIN || word.length > LENGTH_MAX)) return `${LENGTH_MIN} to ${LENGTH_MAX} letters.`;
  const fits = modes.ending ? word.endsWith(cluster) : word.includes(cluster);
  if (fits) return null;
  return `It needs ${wanted(cluster, modes)}${modes.ending ? "" : " in it"}${modes.reverse ? REVERSED_NOTE : ""}.`;
}

/**
 * Every line of copy names the letters to TYPE (the effective cluster), never
 * the bomb's: "IVE at the end", not "EVI backwards", which players misread.
 */
export function wanted(cluster: string, modes: BombModes): string {
  return `${cluster.toUpperCase()}${modes.ending ? " at the end" : ""}`;
}

/** Tacked on wherever reverse mode might make the bomb and the copy look like they disagree. */
export const REVERSED_NOTE = " (the bomb's backwards)";

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
