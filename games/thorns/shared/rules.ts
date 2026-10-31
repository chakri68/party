import type { Disc } from "./types.ts";

/** Everything someone owns, in hand or on the mat. */
export function discCount(p: { roses: number; thorn: boolean }): number {
  return p.roses + (p.thorn ? 1 : 0);
}

/**
 * What's in hand: owned minus what's on the mat. Roses first, so the order of
 * a hand never hints at anything.
 */
export function handOf(p: { roses: number; thorn: boolean; stack: readonly Disc[] }): Disc[] {
  const rosesDown = p.stack.filter((d) => d === "rose").length;
  const thornDown = p.stack.includes("thorn");
  const hand: Disc[] = Array.from({ length: Math.max(0, p.roses - rosesDown) }, () => "rose");
  if (p.thorn && !thornDown) hand.push("thorn");
  return hand;
}

/**
 * The disc a failed challenge costs, from a uniform pick over everything owned:
 * indices below `roses` are roses, the last one is the thorn.
 */
export function lostDiscAt(p: { roses: number; thorn: boolean }, index: number): Disc {
  return index < p.roses ? "rose" : "thorn";
}

/** "a rose", "your thorn". */
export function discName(d: Disc, own = false): string {
  return d === "rose" ? "a rose" : own ? "your thorn" : "a thorn";
}

/** "1 disc", "3 discs". */
export function discsText(n: number): string {
  return `${n} ${n === 1 ? "disc" : "discs"}`;
}

/** "1 point", "2 points". */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? "point" : "points"}`;
}
