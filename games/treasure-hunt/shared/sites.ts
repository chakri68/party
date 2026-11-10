// Layer 3 (§4.2): set pieces. Each template has a site rule, read off the
// macro grid. Candidates are macro vertices, so a piece sits where the heights
// are exact. Templates take turns, round-robin, so one kind can't crowd out
// the rest, and each places at most 3 times.

import { macroHeight } from "./generate.ts";
import type { Rng } from "./noise.ts";
import { TEMPLATES } from "./templates.ts";
import type { SetPiece, TemplateId, TreasureLayout } from "./types.ts";
import { BIOMES, type Biome } from "./world.ts";

export const PIECE_BOUND = 690;
export const PIECE_GAP = 150;
export const PIECE_SPAWN_GAP = 60;
export const PIECE_MIN_HEIGHT = 0.5;
export const PIECES_MIN = 10;
export const PIECES_MAX = 14;
const PER_TEMPLATE = 3;

const shuffle = <T>(a: T[], r: Rng): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Highest minus lowest macro height over a pad: its centre and 8 points on its rim. */
export function padSpread(l: TreasureLayout, x: number, z: number, r: number): number {
  let lo = macroHeight(l, x, z);
  let hi = lo;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    const h = macroHeight(l, x + Math.cos(a) * r, z + Math.sin(a) * r);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

/** Site facts for one macro vertex, computed once and shared by every rule. */
interface Site {
  x: number;
  z: number;
  h: number;
  biome: Biome;
  /** Distance to the nearest vertex below 0 m, out to 120 m (else Infinity). */
  sea: number;
  /** No vertex within 150 m is higher. */
  peak: boolean;
}

const RULES: Record<TemplateId, (l: TreasureLayout, s: Site) => boolean> = {
  lighthouse: (l, s) => l.ring.includes("sea") && s.sea <= 120 && s.h >= 8,
  shipwreck: (_, s) => s.sea <= 40 && s.h >= 0.5 && s.h <= 4,
  "stone-circle": (l, s) => s.biome === "meadow" && padSpread(l, s.x, s.z, TEMPLATES["stone-circle"].padR) <= 2,
  "radio-tower": (_, s) => s.peak,
  camp: (l, s) => s.biome === "forest" && padSpread(l, s.x, s.z, TEMPLATES.camp.padR) <= 3,
  plane: (l, s) => s.biome !== "forest" && s.biome !== "snowcap" && padSpread(l, s.x, s.z, TEMPLATES.plane.padR) <= 3,
  windmill: (l, s) => (s.biome === "meadow" || s.biome === "rocky") && s.h >= 12 && padSpread(l, s.x, s.z, TEMPLATES.windmill.padR) <= 3,
  farm: (l, s) => (s.biome === "meadow" || s.biome === "wetland") && padSpread(l, s.x, s.z, TEMPLATES.farm.padR) <= 2,
  watchtower: (l, s) => s.biome !== "forest" && s.h >= 15 && padSpread(l, s.x, s.z, TEMPLATES.watchtower.padR) <= 3,
  lookout: (l, s) => s.biome === "forest" && s.h >= 10 && padSpread(l, s.x, s.z, TEMPLATES.lookout.padR) <= 3,
  garden: (l, s) => s.biome === "meadow" && padSpread(l, s.x, s.z, TEMPLATES.garden.padR) <= 2,
  quarry: (l, s) => s.biome === "rocky" && padSpread(l, s.x, s.z, TEMPLATES.quarry.padR) <= 4,
  cave: (l, s) => s.biome === "rocky" && padSpread(l, s.x, s.z, TEMPLATES.cave.padR) <= 6,
  "hot-spring": (l, s) => (s.biome === "rocky" || s.biome === "wetland") && padSpread(l, s.x, s.z, TEMPLATES["hot-spring"].padR) <= 2,
  "frozen-lake": (l, s) =>
    (s.biome === "snowcap" || (s.biome === "rocky" && s.h >= 25)) && padSpread(l, s.x, s.z, TEMPLATES["frozen-lake"].padR) <= 3,
  "siege-camp": (l, s) => (s.biome === "meadow" || s.biome === "rocky") && padSpread(l, s.x, s.z, TEMPLATES["siege-camp"].padR) <= 3,
};

/** Every vertex that passes the rules shared by all pieces: bounds, land, away from spawn. */
function sites(l: TreasureLayout): Site[] {
  const { origin, cell, size, heights, biomes } = l.macro;
  const H = (i: number, j: number) => heights[j * size + i]! / 10;
  const reach = (d: number) => Math.ceil(d / cell);
  const out: Site[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = origin + i * cell;
      const z = origin + j * cell;
      if (Math.abs(x) > PIECE_BOUND || Math.abs(z) > PIECE_BOUND) continue;
      const h = H(i, j);
      if (h < PIECE_MIN_HEIGHT) continue;
      if (Math.hypot(x - l.spawn.x, z - l.spawn.z) < PIECE_SPAWN_GAP) continue;
      let sea = Infinity;
      let peak = true;
      const k = reach(150);
      for (let b = Math.max(0, j - k); b <= Math.min(size - 1, j + k); b++) {
        for (let a = Math.max(0, i - k); a <= Math.min(size - 1, i + k); a++) {
          const d = Math.hypot((a - i) * cell, (b - j) * cell);
          if (d > 150) continue;
          const v = H(a, b);
          if (v > h) peak = false;
          if (v < 0 && d <= 120) sea = Math.min(sea, d);
        }
      }
      out.push({ x, z, h, biome: BIOMES[biomes[j * size + i]!]!, sea, peak });
    }
  }
  return out;
}

/**
 * Layer 3: 10–14 set pieces. Roll a target, then walk the templates in a
 * shuffled order, round-robin. Each turn places the template at its next
 * shuffled site that is far enough from every piece so far. Stops at the
 * target, or when a full round places nothing.
 */
export function placePieces(l: TreasureLayout, r: Rng): SetPiece[] {
  const target = PIECES_MIN + Math.floor(r() * (PIECES_MAX - PIECES_MIN + 1));
  const order = shuffle(Object.keys(TEMPLATES) as TemplateId[], r);
  const all = sites(l);
  const queue = new Map(order.map((t) => [t, shuffle(all.filter((s) => RULES[t](l, s)), r)]));
  const labels = new Map(order.map((t) => [t, shuffle([0, 1, 2], r)]));
  const placed: SetPiece[] = [];
  const count = new Map<TemplateId, number>();

  for (let progress = true; progress && placed.length < target; ) {
    progress = false;
    for (const t of order) {
      if (placed.length >= target) break;
      const n = count.get(t) ?? 0;
      if (n >= PER_TEMPLATE) continue;
      const q = queue.get(t)!;
      let s: Site | undefined;
      while ((s = q.shift())) {
        const site = s;
        if (placed.every((p) => Math.hypot(p.x - site.x, p.z - site.z) >= PIECE_GAP)) break;
      }
      if (!s) continue;
      const tpl = TEMPLATES[t];
      placed.push({
        id: `p${placed.length}`,
        template: t,
        x: Math.round(s.x * 10) / 10 + 0,
        z: Math.round(s.z * 10) / 10 + 0,
        yaw: Math.round(r() * 2 * Math.PI * 1000) / 1000,
        padY: Math.round(s.h * 10) / 10 + 0,
        padR: tpl.padR,
        variant: labels.get(t)![n]!,
        params: tpl.roll(r),
      });
      count.set(t, n + 1);
      progress = true;
    }
  }
  return placed;
}

/** What validateLayout checks about layer 3. */
export function validatePieces(l: TreasureLayout): string[] {
  const problems: string[] = [];
  const ps = l.pieces;
  if (ps.length < PIECES_MIN || ps.length > PIECES_MAX) problems.push(`pieces: ${ps.length}, want ${PIECES_MIN}–${PIECES_MAX}`);
  ps.forEach((p, i) => {
    if (Math.abs(p.x) > PIECE_BOUND || Math.abs(p.z) > PIECE_BOUND) problems.push(`pieces: ${p.id} is out of bounds`);
    if (macroHeight(l, p.x, p.z) < PIECE_MIN_HEIGHT) problems.push(`pieces: ${p.id} is too low`);
    if (Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z) < PIECE_SPAWN_GAP) problems.push(`pieces: ${p.id} is on the spawn`);
    for (const q of ps.slice(0, i)) {
      if (Math.hypot(p.x - q.x, p.z - q.z) < PIECE_GAP) problems.push(`pieces: ${p.id} is too close to ${q.id}`);
    }
  });
  return problems;
}
