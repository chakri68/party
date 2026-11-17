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
}

/** More camels than this are not drawn, unless that many have riders. */
export const MAX_CAMELS = 6;
// Spacing at s = 1: the left margin, camel to camel, the lead camel to the rear walker, walker to walker.
const LEFT = 34;
const CAMEL_GAP = 58;
const TO_WALKERS = 38;
const WALKER_GAP = 19;
/** The caravan keeps to the left part of the band; event scenes play to its right. */
const SPAN = 0.62;

export function layoutCaravan(v: View, walkers: CaravanWalker[], camels: number): CaravanLayout {
  const riders = walkers.filter((w) => w.riding);
  const n = Math.max(0, Math.min(camels, Math.max(MAX_CAMELS, riders.length)));
  const seat = new Map<string, number>();
  riders.slice(0, n).forEach((w, k) => seat.set(w.id, n - 1 - k));
  const foot = walkers.filter((w) => !seat.has(w.id));
  const m = foot.length;
  const span = (n > 0 ? (n - 1) * CAMEL_GAP + TO_WALKERS : 0) + Math.max(0, m - 1) * WALKER_GAP;
  const room = (v.w / v.s) * SPAN - LEFT;
  const k = span > room && span > 0 ? Math.max(0.45, room / span) : 1;
  const u = v.s * k;
  const left = LEFT * v.s;
  const camelX = Array.from({ length: n }, (_, i) => left + (n - 1 - i) * CAMEL_GAP * u);
  const start = n > 0 ? camelX[0]! + TO_WALKERS * u : left;
  const footX = new Map<string, number>();
  // The first in seat order leads.
  foot.forEach((w, j) => footX.set(w.id, start + (m - 1 - j) * WALKER_GAP * u));
  const x0 = n > 0 ? camelX[n - 1]! : m > 0 ? footX.get(foot[m - 1]!.id)! : left;
  const x1 = m > 0 ? footX.get(foot[0]!.id)! : n > 0 ? camelX[0]! : left;
  return { camelX, seat, footX, x0, x1 };
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
  const s = v.s;
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
