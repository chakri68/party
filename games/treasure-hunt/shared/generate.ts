// World generator, layers 1–3 (§4.2): the macro heightfield, the edge ring,
// the biomes and the set pieces (sites.ts). A pure function of the seed.
//
// The height at a point is built in three passes:
//   1. Interior: a low base noise, plus basins and ridges (faded out near the
//      edge), minus river valleys, then a soft floor at 3–6 m so the inside
//      stays land.
//   2. The ring reads the interior at the point clamped onto the playable
//      square. So along any line straight out from an edge, the interior part
//      is constant, and the ring profile alone decides the climb or the drop.
//   3. Sea sides pull the height down to a beach-then-seabed profile (smooth
//      min). Mountain sides then add a rise on top. Where the two meet in a
//      corner, the mountain wins: it is the steeper rule.

import { fbm2, rng } from "./noise.ts";
import { placePieces, validatePieces } from "./sites.ts";
import type { TreasureLayout } from "./types.ts";
import {
  BIOMES,
  MACRO_CELL,
  MACRO_ORIGIN,
  MACRO_SIZE,
  PLAY_HALF,
  type Biome,
  type RingSide,
} from "./world.ts";

// Ring rules (§4.4), checked by validateLayout.
const MOUNTAIN_OUT = 96; // metres past the edge…
const MOUNTAIN_RISE = 81; // …must be this much higher than the edge (≈ 40°)
const SEA_OUT = 64; // metres past the edge…
const SEA_DEPTH = -3; // …must be this deep or deeper
const SHORE_BAND = 150; // the shore lies within this far inside the edge
const CORNER = 100; // sea checks give way to a mountain this close
const SPAWN_MARGIN = 100;
const MIN_LAND = 0.7;

interface Basin { x: number; z: number; r: number; depth: number }
interface Ridge { ax: number; az: number; bx: number; bz: number; h: number; w: number }
interface Valley { pts: [number, number][]; depth: number; width: number }
interface Plan {
  seed: number;
  ring: [RingSide, RingSide, RingSide, RingSide];
  shore: number[]; // per side: how far inside the edge the beach reaches 1 m
  basins: Basin[];
  ridges: Ridge[];
  valleys: Valley[];
}

const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const clampPlay = (v: number) => Math.min(PLAY_HALF, Math.max(-PLAY_HALF, v));

/** Distance from (x, z) to the segment a–b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** How far (x, z) is inside side `side` (N, E, S, W). Negative is outside. */
function inward(side: number, x: number, z: number): number {
  switch (side) {
    case 0: return z + PLAY_HALF;
    case 1: return PLAY_HALF - x;
    case 2: return PLAY_HALF - z;
    default: return x + PLAY_HALF;
  }
}

/** A point on the line through side `side` at `t` along it, `d` metres inside. */
function onSide(side: number, t: number, d: number): [number, number] {
  const e = PLAY_HALF - d;
  switch (side) {
    case 0: return [t, -e];
    case 1: return [e, t];
    case 2: return [t, e];
    default: return [-e, t];
  }
}

function makePlan(seed: number): Plan {
  const r = rng(seed);

  // Each side is sea with p = 0.35. Past two, the extras turn to mountain.
  const ring = [0, 1, 2, 3].map(() => (r() < 0.35 ? "sea" : "mountain")) as Plan["ring"];
  const order = [0, 1, 2, 3].map((i) => ({ i, k: r() })).sort((a, b) => a.k - b.k);
  let seas = 0;
  for (const { i } of order) if (ring[i] === "sea" && ++seas > 2) ring[i] = "mountain";

  const shore = [0, 1, 2, 3].map(() => between(r, 30, 100));

  const basins: Basin[] = [];
  for (let n = 2 + Math.floor(r() * 3); n > 0; n--) {
    basins.push({
      x: between(r, -450, 450), z: between(r, -450, 450),
      r: between(r, 140, 240), depth: between(r, 12, 24),
    });
  }

  const ridges: Ridge[] = [];
  for (let n = 1 + Math.floor(r() * 3); n > 0; n--) {
    const cx = between(r, -400, 400);
    const cz = between(r, -400, 400);
    const a = r() * Math.PI;
    const half = between(r, 150, 350);
    ridges.push({
      ax: cx - Math.cos(a) * half, az: cz - Math.sin(a) * half,
      bx: cx + Math.cos(a) * half, bz: cz + Math.sin(a) * half,
      h: between(r, 40, 60), w: between(r, 70, 110),
    });
  }

  // A valley runs from just past one side to just past another, bending on the way.
  const valleys: Valley[] = [];
  for (let n = 1 + Math.floor(r() * 2); n > 0; n--) {
    const from = Math.floor(r() * 4);
    const to = (from + 1 + Math.floor(r() * 3)) % 4;
    const a = onSide(from, between(r, -500, 500), -60);
    const b = onSide(to, between(r, -500, 500), -60);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    const pts: [number, number][] = [a];
    for (const f of [1 / 3, 2 / 3]) {
      const j = between(r, -150, 150);
      pts.push([a[0] + (b[0] - a[0]) * f + nx * j, a[1] + (b[1] - a[1]) * f + nz * j]);
    }
    pts.push(b);
    valleys.push({ pts, depth: between(r, 8, 15), width: between(r, 40, 80) });
  }

  return { seed, ring, shore, basins, ridges, valleys };
}

/** Pass 1: the inside of the map, at a point already inside the playable square. */
function interior(p: Plan, x: number, z: number): number {
  let h = 22 + 16 * fbm2(p.seed, x / 700, z / 700, 4, 2, 0.5);

  // Basins and ridges fade out over the last 200 m, so the ring sees a calm edge.
  const fade = smoothstep(0, 200, PLAY_HALF - Math.max(Math.abs(x), Math.abs(z)));
  let shape = 0;
  for (const b of p.basins) shape -= b.depth * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r));
  for (const rd of p.ridges) {
    const k = Math.max(0, 1 - segDist(x, z, rd.ax, rd.az, rd.bx, rd.bz) / rd.w);
    if (k === 0) continue;
    const along = 0.75 + 0.25 * fbm2(p.seed ^ 0x2b1d, x / 200, z / 200, 2, 2, 0.5);
    shape += rd.h * along * k * k * (3 - 2 * k);
  }
  h += shape * fade;

  for (const v of p.valleys) {
    let d = Infinity;
    for (let i = 1; i < v.pts.length; i++) {
      const [ax, az] = v.pts[i - 1]!;
      const [bx, bz] = v.pts[i]!;
      d = Math.min(d, segDist(x, z, ax, az, bx, bz));
    }
    h -= v.depth * (1 - smoothstep(v.width / 2, v.width / 2 + 60, d));
  }

  // Soft floor: anything below 6 m eases into 3–6 m. Basin floors become flats.
  return h < 6 ? 3 + 3 * Math.exp((h - 6) / 3) : h;
}

/** Sea profile by distance inside the edge: a gentle seabed, then a beach. */
function seaProfile(shore: number, d: number): number {
  if (d >= shore) return 1 + (d - shore) * 0.5;
  return Math.max(-30, 1 + (d - shore) * 0.08);
}

/** Mountain profile by distance inside the edge: foothills, then a steep wall. */
function mountainProfile(d: number): number {
  if (d >= 60) return 0;
  if (d >= 0) return 0.15 * (60 - d);
  return 9 + 1.1 * -d;
}

/** Polynomial smooth minimum. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

/**
 * Height at (x, z). `inner` caches the interior by clamped position: every
 * ring vertex reads an edge point that some other vertex reads too.
 */
function heightAt(p: Plan, x: number, z: number, inner: Map<number, number>): number {
  const cx = clampPlay(x);
  const cz = clampPlay(z);
  const key = cx * 4096 + cz;
  let h = inner.get(key);
  if (h === undefined) inner.set(key, (h = interior(p, cx, cz)));
  for (let s = 0; s < 4; s++) {
    if (p.ring[s] === "sea") h = smin(h, seaProfile(p.shore[s]!, inward(s, x, z)), 6);
  }
  let rise = 0;
  let out = 0; // how far past the nearest mountain edge
  for (let s = 0; s < 4; s++) {
    if (p.ring[s] !== "mountain") continue;
    const d = inward(s, x, z);
    rise = Math.max(rise, mountainProfile(d));
    out = Math.max(out, -d);
  }
  // Peaks only past the checked band, so they can only add to the climb.
  if (out > MOUNTAIN_OUT) {
    const peaks = 15 * (fbm2(p.seed ^ 0x51ab, x / 150, z / 150, 3, 2, 0.5) + 1);
    rise += peaks * smoothstep(MOUNTAIN_OUT, 160, out);
  }
  return h + rise;
}

const vertex = (i: number) => MACRO_ORIGIN + i * MACRO_CELL;
const insidePlay = (i: number, j: number) =>
  Math.abs(vertex(i)) <= PLAY_HALF && Math.abs(vertex(j)) <= PLAY_HALF;

/** Rise per metre at vertex (i, j), from central differences. */
function slopeAt(h: number[], i: number, j: number): number {
  const n = MACRO_SIZE;
  const at = (a: number, b: number) => h[b * n + a]! / 10;
  const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
  const j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
  const gx = (at(i1, j) - at(i0, j)) / ((i1 - i0) * MACRO_CELL);
  const gz = (at(i, j1) - at(i, j0)) / ((j1 - j0) * MACRO_CELL);
  return Math.hypot(gx, gz);
}

function biomeOf(seed: number, x: number, z: number, h: number, slope: number): Biome {
  if (h >= 140) return "snowcap";
  if (slope >= 0.6 || h >= 100) return "rocky";
  const moisture = (fbm2(seed ^ 0x9e37, x / 400, z / 400, 3, 2, 0.5) + 1) / 2;
  if (h < 6 && moisture > 0.55) return "wetland";
  if (moisture > 0.5) return "forest";
  return "meadow";
}

/** The steepest edge of the macro cell holding (x, z), as rise per metre. */
function cellSlope(l: TreasureLayout, x: number, z: number): number {
  const { origin, cell, size, heights } = l.macro;
  const i = Math.min(size - 2, Math.max(0, Math.floor((x - origin) / cell)));
  const j = Math.min(size - 2, Math.max(0, Math.floor((z - origin) / cell)));
  const h = (a: number, b: number) => heights[b * size + a]! / 10;
  const h00 = h(i, j), h10 = h(i + 1, j), h01 = h(i, j + 1), h11 = h(i + 1, j + 1);
  return Math.max(Math.abs(h10 - h00), Math.abs(h11 - h01), Math.abs(h01 - h00), Math.abs(h11 - h10)) / cell;
}

/** Facing the map centre: Godot's forward at yaw θ is (−sin θ, −cos θ). */
const yawToCentre = (x: number, z: number) => Math.atan2(x, z);

function spawnOk(l: TreasureLayout, x: number, z: number, strict: boolean): boolean {
  const lim = PLAY_HALF - SPAWN_MARGIN - (strict ? 50 : 0);
  if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
  return macroHeight(l, x, z) >= (strict ? 2.5 : 2) && cellSlope(l, x, z) < (strict ? 0.2 : 0.25);
}

export function generateLayout(seed: number): TreasureLayout {
  const plan = makePlan(seed);
  const n = MACRO_SIZE;
  const heights: number[] = new Array(n * n);
  const inner = new Map<number, number>();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // + 0 turns −0 into 0, which JSON would otherwise lose on the way to Godot.
      heights[j * n + i] = Math.round(heightAt(plan, vertex(i), vertex(j), inner) * 10) + 0;
    }
  }
  const biomes: number[] = new Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const b = biomeOf(seed, vertex(i), vertex(j), heights[j * n + i]! / 10, slopeAt(heights, i, j));
      biomes[j * n + i] = BIOMES.indexOf(b);
    }
  }

  const layout: TreasureLayout = {
    version: 2,
    seed,
    macro: { origin: MACRO_ORIGIN, cell: MACRO_CELL, size: n, heights, biomes },
    ring: plan.ring,
    spawn: { x: 0, z: 0, yaw: 0 },
    pieces: [],
  };

  // Spawn: the first of up to 200 seeded tries that is on flat land, well inside.
  const r = rng(seed ^ 0x5a5a);
  for (let k = 0; k < 200; k++) {
    const x = Math.round(between(r, -600, 600)) + 0;
    const z = Math.round(between(r, -600, 600)) + 0;
    if (Math.hypot(x, z) < 80 || !spawnOk(layout, x, z, true)) continue;
    layout.spawn = { x, z, yaw: yawToCentre(x, z) };
    break;
  }

  // Its own stream, so layer 3 never shifts layers 1–2.
  layout.pieces = placePieces(layout, rng(seed ^ 0x5e7));
  return layout;
}

/** Bilinear macro height in metres at (x, z). Clamps to the grid. */
export function macroHeight(l: TreasureLayout, x: number, z: number): number {
  const { origin, cell, size, heights } = l.macro;
  const fx = Math.min(size - 1, Math.max(0, (x - origin) / cell));
  const fz = Math.min(size - 1, Math.max(0, (z - origin) / cell));
  const i = Math.min(size - 2, Math.floor(fx));
  const j = Math.min(size - 2, Math.floor(fz));
  const tx = fx - i;
  const tz = fz - j;
  const h = (a: number, b: number) => heights[b * size + a]!;
  const a = h(i, j) * (1 - tx) + h(i + 1, j) * tx;
  const b = h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx;
  return (a * (1 - tz) + b * tz) / 10;
}

export function validateLayout(l: TreasureLayout): string[] {
  const problems: string[] = [];
  const { size, heights, biomes } = l.macro;
  if (size !== MACRO_SIZE || heights.length !== size * size || biomes.length !== size * size) {
    return ["macro grid has the wrong size"];
  }
  if (!heights.every((h) => Number.isFinite(h))) problems.push("a height is not finite");
  if (!biomes.every((b) => Number.isInteger(b) && b >= 0 && b < BIOMES.length)) problems.push("a biome is out of range");

  if (l.ring.filter((s) => s === "sea").length > 2) problems.push("more than two sea sides");
  for (let s = 0; s < 4; s++) {
    for (let t = -PLAY_HALF; t <= PLAY_HALF; t += 16) {
      const h = (d: number) => macroHeight(l, ...onSide(s, t, d));
      if (l.ring[s] === "mountain") {
        if (h(-MOUNTAIN_OUT) - h(0) < MOUNTAIN_RISE) {
          problems.push(`mountain side ${s} is too gentle at ${t}`);
          break;
        }
        continue;
      }
      // Near a corner the neighbouring side's rule takes over: a mountain
      // within CORNER m, or another sea's own shore within SHORE_BAND m.
      const near = (side: number) => PLAY_HALF - Math.abs(t) < (l.ring[side] === "mountain" ? CORNER : SHORE_BAND);
      const towards = t < 0 ? (s === 0 || s === 2 ? 3 : 0) : (s === 0 || s === 2 ? 1 : 2);
      const cornerMountain = near(towards) && l.ring[towards] === "mountain";
      if (cornerMountain) continue;
      if (h(-SEA_OUT) > SEA_DEPTH) {
        problems.push(`sea side ${s} is too shallow at ${t}`);
        break;
      }
      if (near(towards)) continue;
      // Walk in from the sea: the first point at 2 m or more is the shore.
      let shore = Infinity;
      for (let d = -SEA_OUT; d <= SHORE_BAND + 50; d += 4) {
        if (h(d) >= 2) { shore = d; break; }
      }
      if (shore < 0 || shore > SHORE_BAND) {
        problems.push(`sea side ${s} has its shore at ${shore} m in, at ${t}`);
        break;
      }
    }
  }

  let play = 0;
  let land = 0;
  const kinds = new Set<number>();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!insidePlay(i, j)) continue;
      play++;
      if (heights[j * size + i]! > 0) {
        land++;
        kinds.add(biomes[j * size + i]!);
      }
    }
  }
  if (land < MIN_LAND * play) problems.push(`only ${Math.round((100 * land) / play)}% land`);
  if (kinds.size < 3) problems.push(`only ${kinds.size} biomes on land`);

  const { x, z, yaw } = l.spawn;
  if (!spawnOk(l, x, z, false)) problems.push(`spawn (${x}, ${z}) is not on flat land well inside`);
  if (Math.hypot(x, z) > 0 && Math.abs(yaw - yawToCentre(x, z)) > 1e-9) problems.push("spawn does not face the centre");
  if (Math.hypot(x, z) === 0) problems.push("spawn is at the centre, with no direction to face");
  problems.push(...validatePieces(l));
  return problems;
}

/** The first valid layout from seed, seed+1, … (10 tries). Throws if none is. */
export function makeLayout(seed: number): TreasureLayout {
  for (let k = 0; k < 10; k++) {
    const l = generateLayout(seed + k);
    if (validateLayout(l).length === 0) return l;
  }
  throw new Error(`no valid Treasure Hunt layout in seeds ${seed}..${seed + 9}`);
}
