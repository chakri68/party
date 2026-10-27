// The lobby's view of what each mode combination can deal, so it can warn
// and refuse without the dictionary. Keyed `${ending}${length}${category}` as
// 0/1; `reverse` never changes what's solvable. Generated from
// server/prompts.ts, and test/rules.test.ts fails if the two drift: rerun
// the count there and paste it in.

import type { BombModes } from "./types.ts";

export interface Viability {
  /** Prompts with 8+ answers. */
  prompts: number;
  /** Distinct words that answer at least one of them. */
  answers: number;
}

export const VIABLE: Record<string, Viability> = {
  "000": { prompts: 129, answers: 57987 },
  "001": { prompts: 60, answers: 408 },
  "010": { prompts: 129, answers: 44585 },
  "011": { prompts: 35, answers: 274 },
  "100": { prompts: 100, answers: 21672 },
  "101": { prompts: 11, answers: 119 },
  "110": { prompts: 96, answers: 16055 },
  "111": { prompts: 6, answers: 80 },
};

/** Below this many answers in all, a long game can play the pool dry. */
export const THIN_ANSWERS = 150;

export const viabilityKey = (m: BombModes): string => `${+m.ending}${+m.length}${+m.category}`;

/**
 * Why these modes can't be played, or null if they can. `table` is for tests;
 * the real one has no empty combination today, but a list edit could make one.
 */
export function modesProblem(modes: BombModes, table: Record<string, Viability> = VIABLE): string | null {
  const v = table[viabilityKey(modes)];
  return v && v.prompts > 0 ? null : "Too few words fit all of those modes at once.";
}
