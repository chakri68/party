import { CANVAS_H, CANVAS_W, MAX_CHUNK, MAX_GUESS_LENGTH, PALETTE, SIZES, type DrawOp } from "./types.ts";

// ---------------------------------------------------------------------------
// Words and guesses
// ---------------------------------------------------------------------------

/**
 * What a guess is compared as: no accents, no case, letters and digits only.
 * "Ice-cream", "ice cream" and "icecream" are all the same guess.
 */
export function normalizeGuess(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Chat as the server keeps it: one line, no control characters, capped. */
export function cleanChat(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\p{C}/gu, "").trim().slice(0, MAX_GUESS_LENGTH);
}

/** Letters to guess; spaces and hyphens come for free. */
export const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

export function letterCount(word: string): number {
  return [...word].filter(isLetter).length;
}

/** How many letters get handed out over a turn: none for short words, never most of it. */
export function hintCount(word: string): number {
  const n = letterCount(word);
  return n <= 3 ? 0 : n <= 5 ? 1 : 2;
}

/** When hint `k` (0-based) of `count` lands, as elapsed ms into the drawing. */
export function hintAt(k: number, count: number, drawMs: number): number {
  const at = count === 1 ? [0.6] : [0.5, 0.75];
  return Math.round(drawMs * at[k]!);
}

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

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const round5 = (n: number) => Math.round(n / 5) * 5;

/** 300 for an instant guess, down to 50 at the buzzer. */
export function guessPoints(remainingMs: number, drawMs: number): number {
  const left = Math.max(0, Math.min(1, remainingMs / drawMs));
  return round5(50 + 250 * left);
}

/** The drawer's cut of each correct guess: 200 split across everyone who could. */
export function drawerPoints(guessers: number): number {
  return guessers > 0 ? round5(200 / guessers) : 0;
}

// ---------------------------------------------------------------------------
// Draw ops
// ---------------------------------------------------------------------------

const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Even-length, integer, clamped to the page. Null if it isn't coordinates at all. */
function parsePoints(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_CHUNK || v.length % 2) return null;
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const n = v[i];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(Math.min(Math.max(Math.round(n), 0), i % 2 ? CANVAS_H : CANVAS_W));
  }
  return out;
}

/** Untrusted stream data → a clean op, or null. Shape only: the game checks it fits. */
export function parseDrawOp(input: unknown): DrawOp | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (!isInt(o.turn)) return null;
  const turn = o.turn;
  switch (o.op) {
    case "start": {
      const points = parsePoints(o.points);
      if (!points || !isInt(o.id) || !isInt(o.color) || !isInt(o.size)) return null;
      if (o.color < 0 || o.color >= PALETTE.length || o.size < 0 || o.size >= SIZES.length) return null;
      return { turn, op: "start", id: o.id, color: o.color, size: o.size, points };
    }
    case "add": {
      const points = parsePoints(o.points);
      return points && isInt(o.id) ? { turn, op: "add", id: o.id, points } : null;
    }
    case "undo":
    case "clear":
      return { turn, op: o.op };
    default:
      return null;
  }
}
