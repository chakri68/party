// Layer 5 (§4.2): minor points. Rock piles, fallen logs and old campfires
// scattered over the land. Each one holds a single cache slot.

import { cellSlope, macroHeight } from "./generate.ts";
import type { Rng } from "./noise.ts";
import type { Slot } from "./templates.ts";
import type { Trail } from "./trails.ts";
import type { TreasureLayout } from "./types.ts";
import { BIOMES, type Biome } from "./world.ts";

export type MinorKind = "rocks" | "log" | "campfire";
export interface MinorPoint { id: string; kind: MinorKind; x: number; z: number; yaw: number }

export const MINOR_MIN = 40;
export const MINOR_MAX = 80;
export const MINOR_BOUND = 720;
export const MINOR_GAP = 35;
export const MINOR_PIECE_GAP = 20;
export const MINOR_TRAIL_GAP = 6;
/** tan 25°, as rise per metre. */
export const MINOR_MAX_SLOPE = Math.tan((25 * Math.PI) / 180);
const TRIES = 6000;

/**
 * The one cache slot of each kind, in the point's local frame (−Z front, +X
 * right, before yaw). Godot builds the object to these footprints, so the
 * slot lands beside it and never inside it:
 *   rocks    a pile within 0.8 m of the point, none higher than 1 m.
 *   log      lies along Z, 3 m long (z −1.5..1.5), 0.4 m thick each side of x = 0.
 *   campfire a ring of stones within 0.7 m of the point, with a few small logs
 *            inside it.
 * Each slot is 1.2 m from the middle, on the ground (dy 0), clear of all three.
 */
export const MINOR_SLOT: Record<MinorKind, Slot> = {
  rocks: { x: 1.2, z: 0, dy: 0, hint: "Beside a pile of rocks." },
  log: { x: 1.2, z: 0, dy: 0, hint: "Beside a fallen log." },
  campfire: { x: 1.2, z: 0, dy: 0, hint: "Next to an old campfire." },
};

const KINDS: MinorKind[] = ["rocks", "log", "campfire"];

/** Biome of the macro vertex nearest (x, z). */
export function biomeAt(l: TreasureLayout, x: number, z: number): Biome {
  const { origin, cell, size, biomes } = l.macro;
  const i = Math.min(size - 1, Math.max(0, Math.round((x - origin) / cell)));
  const j = Math.min(size - 1, Math.max(0, Math.round((z - origin) / cell)));
  return BIOMES[biomes[j * size + i]!]!;
}

function kindFor(biome: Biome, r: Rng): MinorKind {
  if (biome === "forest") return r() < 0.5 ? "log" : "campfire";
  if (biome === "rocky") return "rocks";
  return KINDS[Math.floor(r() * 3)]!;
}

/** Distance from (x, z) to the nearest trail segment. */
export function trailDistance(trails: Trail[], x: number, z: number): number {
  let best = Infinity;
  for (const t of trails) {
    for (let i = 1; i < t.pts.length; i++) {
      const [ax, az] = t.pts[i - 1]!;
      const [bx, bz] = t.pts[i]!;
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
      best = Math.min(best, Math.hypot(x - (ax + dx * u), z - (az + dz * u)));
    }
  }
  return best;
}

/** Why (x, z) can't hold a minor point, or null if it can. Spacing among minor points is not checked. */
export function minorProblem(l: TreasureLayout, x: number, z: number): string | null {
  if (macroHeight(l, x, z) < 1) return "too low";
  if (cellSlope(l, x, z) >= MINOR_MAX_SLOPE) return "too steep";
  if (l.pieces.some((p) => Math.hypot(x - p.x, z - p.z) < p.padR + MINOR_PIECE_GAP)) return "too close to a piece";
  if (trailDistance(l.trails, x, z) < MINOR_TRAIL_GAP) return "on a trail";
  return null;
}

/** Roll 40–80 minor points. Needs `l.trails` to be set already. */
export function placeMinor(l: TreasureLayout, r: Rng): MinorPoint[] {
  const target = MINOR_MIN + Math.floor(r() * (MINOR_MAX - MINOR_MIN + 1));
  const out: MinorPoint[] = [];
  for (let k = 0; k < TRIES && out.length < target; k++) {
    const x = Math.round((r() * 2 - 1) * MINOR_BOUND * 10) / 10 + 0;
    const z = Math.round((r() * 2 - 1) * MINOR_BOUND * 10) / 10 + 0;
    if (out.some((m) => Math.hypot(x - m.x, z - m.z) < MINOR_GAP)) continue;
    if (minorProblem(l, x, z)) continue;
    out.push({
      id: `m${out.length}`,
      kind: kindFor(biomeAt(l, x, z), r),
      x,
      z,
      yaw: Math.round(r() * 2 * Math.PI * 1000) / 1000 + 0,
    });
  }
  return out;
}

/** What validateLayout checks about layer 5. */
export function validateMinor(l: TreasureLayout): string[] {
  const problems: string[] = [];
  const ms = l.minor;
  if (ms.length < MINOR_MIN || ms.length > MINOR_MAX) problems.push(`minor: ${ms.length}, want ${MINOR_MIN}–${MINOR_MAX}`);
  ms.forEach((m, i) => {
    if (Math.abs(m.x) > MINOR_BOUND || Math.abs(m.z) > MINOR_BOUND) problems.push(`minor: ${m.id} is out of bounds`);
    const why = minorProblem(l, m.x, m.z);
    if (why) problems.push(`minor: ${m.id} is ${why}`);
    for (const o of ms.slice(0, i)) {
      if (Math.hypot(m.x - o.x, m.z - o.z) < MINOR_GAP) problems.push(`minor: ${m.id} is too close to ${o.id}`);
    }
  });
  return problems;
}
