// The numbers: moles, crew sizes, the five jobs. All derived from the head
// count, all public, so the lobby and the table can show them.

import type { HeistSettings, MoleShift } from "./types.ts";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export const JOBS = 5;
/** Jobs a side needs. */
export const TO_WIN = 3;
/** Failed proposals that hand the job to the moles. */
export const MAX_HEAT = 3;
/** Sabotage cards each mole gets for the whole game. */
export const BUDGET = 2;

export const JOB_NAMES: readonly string[] = [
  "Steal the Ledger",
  "Cut the Vault Lights",
  "Swap the Portrait",
  "Crack the Night Safe",
  "Drive the Getaway",
];

/** 2 at 5–6, 3 at 7–8, 4 at 9–10. */
export const usualMoles = (n: number): number => 2 + Math.floor((n - 5) / 2);

/** At least two moles, and always fewer moles than crew. */
export const moleRange = (n: number): [number, number] => [2, Math.floor((n - 1) / 2)];

const SHIFT: Record<MoleShift, number> = { fewer: -1, usual: 0 };

export const molesFor = (settings: HeistSettings, n: number): number => usualMoles(n) + SHIFT[settings.moles];

/**
 * Crew size for job `k` (0..4): ⌈N/3⌉ rising to ⌈N/2⌉, rounded at each step.
 * Small first jobs give a clean crew a chance; by the last, half the table
 * goes in, nearly any crew holds a mole and the vote has to do the work.
 */
export function crewSize(n: number, k: number): number {
  const lo = Math.ceil(n / 3);
  const hi = Math.ceil(n / 2);
  return lo + Math.round(((hi - lo) * k) / (JOBS - 1));
}

export const crewSizes = (n: number): number[] => Array.from({ length: JOBS }, (_, k) => crewSize(n, k));

/**
 * Why these settings can't deal this table, or null. A head count out of range
 * is the lobby's own check (it says so while people are still arriving), so
 * this only speaks once there's a table to deal.
 */
export function setupProblem(settings: HeistSettings, n: number): string | null {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return null;
  const moles = molesFor(settings, n);
  const [lo, hi] = moleRange(n);
  if (moles < lo) return `${n} players need at least ${lo} moles`;
  if (moles > hi) return `${n} players can have ${hi} moles or fewer`;
  return null;
}
