import type { Beat } from "./model.ts";

export interface BeatPos {
  index: number;
  t: number; // 0..1 within the beat; a situation beat loops t over SITUATION_LOOP_MS
}
export const SITUATION_LOOP_MS = 2400;

/** Total length of the sequence, Infinity if any beat is a situation. */
export function totalMs(beats: Beat[]): number {
  let sum = 0;
  for (const b of beats) {
    if (b.ms === Infinity) return Infinity;
    sum += b.ms;
  }
  return sum;
}

/**
 * Where the sequence is at `elapsedMs`. Null with no beats. Past the end it stays on the
 * last beat at t = 1. A negative elapsed counts as 0. At a boundary the next beat starts at t = 0.
 */
export function beatAt(beats: Beat[], elapsedMs: number): BeatPos | null {
  if (beats.length === 0) return null;
  const e = Math.max(0, elapsedMs);
  let start = 0;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (beat.ms === Infinity) return { index: i, t: ((e - start) / SITUATION_LOOP_MS) % 1 };
    if (e < start + beat.ms) return { index: i, t: (e - start) / beat.ms };
    start += beat.ms;
  }
  return { index: beats.length - 1, t: 1 };
}

/**
 * Elapsed time to begin from. A reload mid-report (`snapshot`) starts at the end of the
 * finite beats, so the end state shows at once. Otherwise the sequence starts at 0.
 */
export function startAt(beats: Beat[], opts: { snapshot: boolean }): number {
  if (!opts.snapshot) return 0;
  let sum = 0;
  for (const b of beats) {
    if (b.ms === Infinity) break;
    sum += b.ms;
  }
  return sum;
}
