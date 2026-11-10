// Layer 4 (§4.2): trails. A minimum spanning tree over the pieces and the
// spawn, by plain distance. Each edge is walked as a polyline with a sideways
// sine wobble, then dropped if it crosses water or a cliff. Godot lays the
// trail on the ground as a strip TRAIL_HALF_WIDTH either side of the line.

import { macroHeight } from "./generate.ts";
import type { Rng } from "./noise.ts";
import type { TreasureLayout } from "./types.ts";

/** XZ points, rounded to 0.1 m, about 16 m apart. */
export interface Trail { pts: [number, number][] }

export const TRAIL_HALF_WIDTH = 2;
export const TRAIL_STEP = 16;
export const TRAIL_MAX_EDGE = 450;
export const TRAIL_MIN_HEIGHT = 1;
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
/** Slope limits as rise per metre: 20° first, then 30°, 40° and 50° for what 20° left cut off. */
export const TRAIL_SLOPES = [tan(20), tan(30), tan(40), tan(50)];
const WOBBLE_MAX = 20;
/** A trail may stop this far past the pad edge. The end check allows padR + 4. */
const PULL_IN = 3.5;

const round1 = (v: number) => Math.round(v * 10) / 10 + 0;

interface Node { x: number; z: number; r: number }

/**
 * Walk a→b with a sideways sine wobble, or null if it can't be walked.
 * The wobble is capped by the length so a short edge can't bend so hard that
 * its points drift out of 12–20 m apart.
 */
function walk(l: TreasureLayout, a: Node, b: Node, roll: number, waves: number, maxSlope: number, ra: number, rb: number): Trail | null {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / dist;
  const uz = (b.z - a.z) / dist;
  const len = dist - ra - rb;
  if (len < TRAIL_STEP) return null;
  const sx = a.x + ux * ra;
  const sz = a.z + uz * ra;
  const amp = Math.min(roll, (0.1 * len) / waves);
  const n = Math.round(len / TRAIL_STEP);
  const pts: [number, number][] = [];
  let lastH = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const w = amp * Math.sin(Math.PI * waves * t);
    const x = round1(sx + ux * len * t - uz * w);
    const z = round1(sz + uz * len * t + ux * w);
    const h = macroHeight(l, x, z);
    if (h < TRAIL_MIN_HEIGHT) return null;
    // The slope a walker feels: rise over run from the last point.
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(h - lastH) / Math.hypot(x - prev[0], z - prev[1]) > maxSlope) return null;
    lastH = h;
    pts.push([x, z]);
  }
  return { pts };
}

/**
 * The spanning tree over the pieces and the spawn, by plain distance, without
 * edges over 450 m. Kruskal order: shortest edge first, taken if it joins two
 * separate trees and can be walked. Where the tree's own edge is blocked by
 * water or a cliff, the next shortest edge joins the pieces instead, so no
 * piece is left alone while another is in reach. If every edge is walkable
 * this is the plain minimum spanning tree. A blocked wobbly edge is tried once
 * more as a straight line.
 *
 * Slope: the brief's limit is 20°, but a radio tower sits on a peak, and
 * every way off a peak is steeper than that. So the pass runs at 20° first,
 * then again at 30°, 40° and 50° for the trees it left apart. Water is never relaxed.
 */
export function makeTrails(l: TreasureLayout, r: Rng): Trail[] {
  const ns: Node[] = [
    { x: l.spawn.x, z: l.spawn.z, r: 0 },
    ...l.pieces.map((p) => ({ x: p.x, z: p.z, r: p.padR })),
  ];
  const edges: [number, number, number][] = [];
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const d = Math.hypot(ns[i]!.x - ns[j]!.x, ns[i]!.z - ns[j]!.z);
      if (d <= TRAIL_MAX_EDGE) edges.push([d, i, j]);
    }
  }
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);

  const tree = ns.map((_, i) => i);
  const find = (i: number): number => (tree[i] === i ? i : (tree[i] = find(tree[i]!)));
  const out: Trail[] = [];
  for (const maxSlope of TRAIL_SLOPES) {
    for (const [, i, j] of edges) {
      if (find(i) === find(j)) continue;
      // Rolled for every edge looked at, so a drop never shifts the next roll.
      const roll = r() * WOBBLE_MAX;
      const waves = 1 + Math.floor(r() * 2);
      const a = ns[i]!;
      const b = ns[j]!;
      let trail: Trail | null = null;
      // Straight if the wobble fails; then ends pulled in from the pad edge
      // (a beach pad can be under 1 m at its rim and over it a few metres in).
      for (const [ra, rb] of [[a.r, b.r], [a.r + PULL_IN, b.r], [a.r, b.r + PULL_IN], [a.r + PULL_IN, b.r + PULL_IN]] as const) {
        trail = walk(l, a, b, roll, waves, maxSlope, ra, rb) ?? walk(l, a, b, 0, 1, maxSlope, ra, rb);
        if (trail) break;
      }
      if (!trail) continue;
      tree[find(i)] = find(j);
      out.push(trail);
    }
  }
  return out;
}

/**
 * What validateLayout checks about layer 4: a piece with another piece in
 * reach must have a trail ending at its pad. A shipwreck on a 0.6 m beach or
 * a radio tower on a sheer peak can fail that, and then the seed rerolls.
 */
export function validateTrails(l: TreasureLayout): string[] {
  const problems: string[] = [];
  for (const p of l.pieces) {
    const reach = l.pieces.some((q) => q !== p && Math.hypot(p.x - q.x, p.z - q.z) <= TRAIL_MAX_EDGE);
    if (!reach) continue;
    const joined = l.trails.some((t) =>
      [t.pts[0]!, t.pts[t.pts.length - 1]!].some((e) => Math.hypot(e[0] - p.x, e[1] - p.z) <= p.padR + 4),
    );
    if (!joined) problems.push(`trails: ${p.id} has no trail`);
  }
  return problems;
}
