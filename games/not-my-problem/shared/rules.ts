import { PROBLEM_TEXT } from "./cards.ts";
import type { ProblemKind } from "./types.ts";

/** Warnings a Problem gives if nobody fixes it. */
export function penaltyOf(kind: ProblemKind): 1 | 2 {
  return PROBLEM_TEXT[kind].penalty;
}
