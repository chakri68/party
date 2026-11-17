// The caravan: where each camel and traveller stands, and drawing them. The
// camels walk at the rear, the travellers on foot ahead of them, and the whole
// line faces right. Riders sit on camels from the rear camel forward, so the
// lead camel is the last to carry anyone.
import type { Health } from "../../shared/types.ts";
import type { View } from "./backdrop.ts";
import type { Pose } from "./events/index.ts";
import { CAMEL_SEAT, drawCamel, drawTraveller } from "./sprites.ts";

type C = CanvasRenderingContext2D;

export interface CaravanWalker {
  id: string;
  color: string;
  health: Health;
  riding: boolean;
  alpha: number;
}
export interface CaravanLayout {
  camelX: number[]; // feet x of each camel drawn, index 0 = the lead (rightmost)
  seat: Map<string, number>; // rider id -> camel index
  footX: Map<string, number>; // feet x of each traveller on foot
  x0: number; // the rear sprite's feet
  x1: number; // the lead sprite's feet
  spacing: number; // the gaps' share of their full size, 1 = not squeezed
  size: number; // the sprites' scale, 1 = full size, never below MIN_SIZE
}

/**
 * How one walker is drawn in a beat, or null when not at all. A walker fading in
 * this beat fades by 1 - t. One who died in the event already has health 0 in
 * settle, so they are drawn at 1 (badly hurt) while they fade, not dropped at once.
 */
export function walkerLook(w: { fading: boolean; health: Health; t: number }): { health: Health; alpha: number } | null {
  const alpha = w.fading ? 1 - w.t : 1;
  if (alpha <= 0) return null;
  if (w.health === 0) return w.fading ? { health: 1, alpha } : null;
  return { health: w.health, alpha };
}

/** More camels than this are not drawn, unless that many have riders. */
export const MAX_CAMELS = 6;
// Spacing at s = 1: the left margin, camel to camel, the lead camel to the rear walker, walker to walker.
const LEFT = 28;
const CAMEL_GAP = 46;
const TO_WALKERS = 44;
const WALKER_GAP = 23; // just over a walker's hips (12 x TRAVELLER = 19.2) at MIN_SPACING
/** The caravan keeps to the left part of the band; event scenes play to its right. */
const SPAN = 0.7;
/** Gaps squeezed below this share of their size (k / size) make a heap: draw fewer camels first, then smaller sprites. */
const MIN_SPACING = 0.85;
const MIN_SIZE = 0.85;
/** The tightest squeeze, for a caravan that still does not fit. */
const MAX_SQUEEZE = 0.45;

/**
 * Where everyone stands. A crowded caravan first draws fewer camels (never fewer
 * than carry riders, and at least one if there are any), then draws smaller
 * sprites, down to MIN_SIZE. Travellers are never dropped.
 */
export function layoutCaravan(v: View, walkers: CaravanWalker[], camels: number): CaravanLayout {
  const riders = walkers.filter((w) => w.riding);
  const most = Math.max(0, Math.min(camels, Math.max(MAX_CAMELS, riders.length)));
  const fewest = Math.min(most, Math.max(camels > 0 ? 1 : 0, riders.length));
  const room = (v.w / v.s) * SPAN - LEFT;
  const spanOf = (n: number) => {
    const m = walkers.length - Math.min(n, riders.length);
    return (n > 0 ? (n - 1) * CAMEL_GAP + TO_WALKERS : 0) + Math.max(0, m - 1) * WALKER_GAP;
  };
  const fit = (n: number) => (spanOf(n) > room && spanOf(n) > 0 ? room / spanOf(n) : 1);
  let n = most;
  while (n > fewest && fit(n) < MIN_SPACING) n--;
  const k = Math.max(MAX_SQUEEZE, fit(n));
  const size = Math.max(MIN_SIZE, Math.min(1, k / MIN_SPACING));
  const seat = new Map<string, number>();
  riders.slice(0, n).forEach((w, j) => seat.set(w.id, n - 1 - j));
  // Riders with no camel drawn walk, with a limp.
  const foot = walkers.filter((w) => !seat.has(w.id));
  const m = foot.length;
  const u = v.s * k;
  const left = LEFT * v.s;
  const camelX = Array.from({ length: n }, (_, i) => left + (n - 1 - i) * CAMEL_GAP * u);
  const start = n > 0 ? camelX[0]! + TO_WALKERS * u : left;
  const footX = new Map<string, number>();
  // The first in seat order leads.
  foot.forEach((w, j) => footX.set(w.id, start + (m - 1 - j) * WALKER_GAP * u));
  const x0 = n > 0 ? camelX[n - 1]! : m > 0 ? footX.get(foot[m - 1]!.id)! : left;
  const x1 = m > 0 ? footX.get(foot[0]!.id)! : n > 0 ? camelX[0]! : left;
  return { camelX, seat, footX, x0, x1, spacing: k, size };
}

/** Draws `fn` at x, turned round about x when facing left. */
function at(c: C, x: number, facing: 1 | -1, fn: (x: number) => void): void {
  if (facing === 1) return fn(x);
  c.save();
  c.translate(x, 0);
  c.scale(-1, 1);
  fn(0);
  c.restore();
}

/** Squashes what `fn` draws down towards the ground at y, for a crouch. */
function crouched(c: C, x: number, y: number, on: boolean, fn: () => void): void {
  if (!on) return fn();
  c.save();
  c.translate(x, y);
  c.scale(1, 0.8);
  c.translate(-x, -y);
  fn();
  c.restore();
}

/** Each sprite steps a little out of time with the others. A still frame (0) stays 0. */
const stepOf = (frame: number, i: number, rate = 1) => (frame === 0 ? 0 : frame * rate + i * 0.27);
const rateOf = (health: Health) => (health === 1 ? 0.7 : health === 2 ? 0.85 : 1);

export function drawCaravan(
  c: C,
  v: View,
  walkers: CaravanWalker[],
  lay: CaravanLayout,
  pose: Pose,
  frame: number,
  load: "normal" | "high",
  moveFrame = frame, // the walk frame of a traveller the pose moves out of line
): void {
  const s = v.s * lay.size;
  const g = v.ground;
  const dx = pose.dx ?? 0;
  const facing = pose.facing ?? 1;
  const byCamel = new Map<number, CaravanWalker>();
  for (const w of walkers) {
    const i = lay.seat.get(w.id);
    if (i !== undefined) byCamel.set(i, w);
  }
  // Camels, rear first, each with its rider.
  for (let i = lay.camelX.length - 1; i >= 0; i--) {
    const x = lay.camelX[i]! + dx;
    const rider = byCamel.get(i);
    const hidden = pose.hideCamel === i;
    if (!hidden) {
      at(c, x, facing, (cx) => {
        drawCamel(c, cx, g, s, stepOf(frame, i, 0.9), rider ? "normal" : load);
        if (rider && pose.down !== rider.id)
          drawTraveller(c, cx + CAMEL_SEAT.x * s, g + CAMEL_SEAT.y * s, s, stepOf(frame, i, 0.9), { ...rider, riding: true });
      });
    }
    // A rider whose camel is out of line, or who lies down, is drawn on the ground by its place.
    if (rider && (hidden || pose.down === rider.id))
      at(c, x, facing, (cx) => drawTraveller(c, cx, g, s, 0, { ...rider, riding: false, down: pose.down === rider.id }));
  }
  // Travellers on foot, rear first.
  const foot = walkers.filter((w) => lay.footX.has(w.id));
  for (let j = foot.length - 1; j >= 0; j--) {
    const w = foot[j]!;
    const mv = pose.move?.id === w.id ? pose.move : null;
    const x = mv ? mv.x : lay.footX.get(w.id)! + dx;
    const down = pose.down === w.id;
    const step = mv ? moveFrame : stepOf(frame, j, rateOf(w.health));
    crouched(c, x, g, !down && (mv ? mv.crouch : !!pose.crouch), () =>
      at(c, x, mv ? mv.facing : facing, (cx) => drawTraveller(c, cx, g, s, step, { ...w, riding: false, down })),
    );
  }
}
