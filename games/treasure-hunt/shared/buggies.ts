// Where the buggies park (§7.2). Pure: the same layout, the same slots, on the
// server and in every test.
//
//   t0..t7   team slots on a ring round the spawn, facing the spawn yaw. The
//            8 flattest of 16 spots, at least 4 m apart, in angle order.
//   l0..l2   loose ones, each just off a seeded set piece, facing the spawn.

import { macroHeight } from "./generate.ts";
import { rng } from "./noise.ts";
import type { TreasureLayout } from "./types.ts";
import { LOOSE_BUGGIES, SEA_LEVEL } from "./world.ts";

export interface BuggySlot {
  id: string;
  x: number;
  z: number;
  /** Radians, Godot style: yaw 0 faces −Z. */
  yaw: number;
}

const TEAM_SLOTS = 8;
const CANDIDATES = 16;
const RINGS = [8, 12];
const MIN_GAP = 4;
/** The buggy's footprint: width × length. */
const HALF_W = 1.2;
const HALF_L = 2.15;
/** Above this is land. A hair over sea level, so a slot never sits in the surf. */
const LAND = SEA_LEVEL + 0.5;
/** Seed stream for the loose buggies: "BUGG". */
const LOOSE_SEED = 0x42554747;

const round2 = (v: number) => Math.round(v * 100) / 100 + 0;
/** Godot's forward at yaw θ is (−sin θ, −cos θ), so this yaw looks along (dx, dz). */
const yawAlong = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Max height step over the footprint's four corners at `yaw`: 0 is dead flat. */
function bumpiness(l: TreasureLayout, x: number, z: number, yaw: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  // Right is forward turned a quarter clockwise, seen from above.
  const rx = -fz;
  const rz = fx;
  const hs = [-1, 1].flatMap((a) => [-1, 1].map((b) => macroHeight(l, x + rx * HALF_W * a + fx * HALF_L * b, z + rz * HALF_W * a + fz * HALF_L * b)));
  return Math.max(...hs) - Math.min(...hs);
}

function teamSlots(l: TreasureLayout): BuggySlot[] {
  const { spawn } = l;
  let picks: { k: number; x: number; z: number }[] = [];
  for (const r of RINGS) {
    const cands = Array.from({ length: CANDIDATES }, (_, k) => {
      const a = (k * 2 * Math.PI) / CANDIDATES;
      const x = spawn.x + r * Math.sin(a);
      const z = spawn.z + r * Math.cos(a);
      return { k, x, z, bump: bumpiness(l, x, z, spawn.yaw) };
    })
      .filter((c) => macroHeight(l, c.x, c.z) > LAND)
      // Ties keep angle order, so the sort is stable across engines.
      .sort((a, b) => a.bump - b.bump || a.k - b.k);
    picks = [];
    for (const c of cands) {
      if (picks.length >= TEAM_SLOTS) break;
      if (picks.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < MIN_GAP)) continue;
      picks.push(c);
    }
    if (picks.length >= TEAM_SLOTS) break;
  }
  return picks
    .sort((a, b) => a.k - b.k)
    .map((p, i) => ({ id: `t${i}`, x: round2(p.x), z: round2(p.z), yaw: spawn.yaw }));
}

function looseSlots(l: TreasureLayout): BuggySlot[] {
  const r = rng(l.seed ^ LOOSE_SEED);
  const order = [...l.pieces];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const out: BuggySlot[] = [];
  for (const p of order) {
    if (out.length >= LOOSE_BUGGIES) break;
    const dx = l.spawn.x - p.x;
    const dz = l.spawn.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    const off = p.padR + 5;
    const x = round2(p.x + (dx / d) * off);
    const z = round2(p.z + (dz / d) * off);
    if (macroHeight(l, x, z) <= LAND) continue;
    out.push({ id: `l${out.length}`, x, z, yaw: round2(yawAlong(l.spawn.x - x, l.spawn.z - z)) });
  }
  return out;
}

/** Every parking slot on the map: team slots t0..t7, then loose slots l0.. (up to LOOSE_BUGGIES). */
export function buggySlots(l: TreasureLayout): BuggySlot[] {
  return [...teamSlots(l), ...looseSlots(l)];
}
