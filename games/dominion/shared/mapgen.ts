// World generation (§4), version GENERATOR_VERSION. Pure function of
// (seed, size, factions, settings): same inputs, same world, forever, so a
// pinned match can always be regenerated for replays.
//
// Pipeline: noise fields → land mask → starts → start shaping → water depth →
// resources → villages → ruins → fairness check. Up to 32 attempts, then a
// plain template that's known to pass.

import { FACTIONS, HARVEST, TERRAIN } from "./content.ts";
import { area, chebyshev, colOf, indexOf, neighbors, rowOf, Rng, streamSeed } from "./grid.ts";
import type { FactionKind, MapType, Resource, ResourceSetting, Terrain, Tile } from "./types.ts";

export const MAX_ATTEMPTS = 32;
export const MIN_START_DISTANCE = 6;
/** Every start needs a neutral village at most this far away. */
export const VILLAGE_REACH = 5;
/** Weakest start's nearby resource value must be at least this share of the strongest's. */
export const FAIRNESS = 0.6;

export interface WorldOptions {
  mapType: MapType;
  resources: ResourceSetting;
}

export interface World {
  tiles: Tile[];
  /** One per faction, in the order given. */
  starts: number[];
  attempts: number;
  template: boolean;
}

const blank = (t: Terrain): Tile => ({ t, res: null, imp: null, road: false, feat: null, city: null, claim: null });

const RESOURCE_SCALE: Record<ResourceSetting, number> = { sparse: 0.6, standard: 1, abundant: 1.5 };

export function generateWorld(seed: number, size: number, kinds: FactionKind[], opts: WorldOptions): World {
  const rng = new Rng(streamSeed(seed, 0));
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const world = tryGenerate(rng, size, kinds, opts);
    if (world && validateWorld(world.tiles, world.starts, size)) return { ...world, attempts: attempt, template: false };
  }
  return { ...templateWorld(size, kinds), attempts: MAX_ATTEMPTS, template: true };
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function valueNoise(rng: Rng, size: number, cell: number): Float64Array {
  const n = Math.ceil(size / cell) + 2;
  const lattice = Float64Array.from({ length: n * n }, () => rng.next());
  const out = new Float64Array(size * size);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const y = r / cell;
      const x = c / cell;
      const y0 = Math.floor(y);
      const x0 = Math.floor(x);
      const ty = smooth(y - y0);
      const tx = smooth(x - x0);
      const v = (yy: number, xx: number) => lattice[yy * n + xx]!;
      const top = v(y0, x0) * (1 - tx) + v(y0, x0 + 1) * tx;
      const bottom = v(y0 + 1, x0) * (1 - tx) + v(y0 + 1, x0 + 1) * tx;
      out[r * size + c] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

function fractal(rng: Rng, size: number): Float64Array {
  const octaves: [number, number][] = [[8, 0.55], [4, 0.3], [2, 0.15]];
  const out = new Float64Array(size * size);
  for (const [cell, weight] of octaves) {
    const layer = valueNoise(rng, size, cell);
    for (let i = 0; i < out.length; i++) out[i]! += layer[i]! * weight;
  }
  return out;
}

/** The value below which `share` of the entries fall. */
function quantile(values: ArrayLike<number>, share: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))]!;
}

// ---------------------------------------------------------------------------
// Connectivity. Orthogonal steps only: a diagonal between two blocked tiles
// isn't a legal move (§8), so 4-connectivity never overstates what's reachable.
// ---------------------------------------------------------------------------

export const walkable = (t: Terrain) => TERRAIN[t].land && !TERRAIN[t].needs;

/** Component id per tile (-1 where `pass` is false). */
export function components(tiles: Tile[], size: number, pass: (t: Tile) => boolean): Int32Array {
  const comp = new Int32Array(tiles.length).fill(-1);
  let next = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (comp[i] !== -1 || !pass(tiles[i]!)) continue;
    const stack = [i];
    comp[i] = next;
    while (stack.length) {
      const cur = stack.pop()!;
      const r = rowOf(cur, size);
      const c = colOf(cur, size);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const j = indexOf(rr, cc, size);
        if (comp[j] === -1 && pass(tiles[j]!)) {
          comp[j] = next;
          stack.push(j);
        }
      }
    }
    next++;
  }
  return comp;
}

// ---------------------------------------------------------------------------
// One attempt
// ---------------------------------------------------------------------------

function tryGenerate(rng: Rng, size: number, kinds: FactionKind[], opts: WorldOptions): Omit<World, "attempts" | "template"> | null {
  const height = fractal(rng, size);
  const rough = fractal(rng, size);
  const moist = fractal(rng, size);
  const mid = (size - 1) / 2;

  // Landmass: one big island, water at the rim. Lakes: mostly land, water pools inland.
  const landShare = opts.mapType === "lakes" ? 0.8 : 0.6;
  const falloff = opts.mapType === "lakes" ? 0.25 : 0.9;
  const shaped = height.map((h, i) => {
    const dy = (rowOf(i, size) - mid) / mid;
    const dx = (colOf(i, size) - mid) / mid;
    return h - falloff * (dx * dx + dy * dy);
  });
  const seaLevel = quantile(shaped, 1 - landShare);

  const tiles: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    const r = rowOf(i, size);
    const c = colOf(i, size);
    const edge = r === 0 || c === 0 || r === size - 1 || c === size - 1;
    tiles.push(blank(!edge && shaped[i]! >= seaLevel ? "plains" : "ocean"));
  }
  const landIdx = tiles.flatMap((t, i) => (t.t === "plains" ? [i] : []));
  const mountainLevel = quantile(landIdx.map((i) => rough[i]!), 0.88);
  const forestLevel = quantile(landIdx.map((i) => moist[i]!), 0.66);
  for (const i of landIdx) {
    if (rough[i]! >= mountainLevel) tiles[i]!.t = "mountain";
    else if (moist[i]! >= forestLevel) tiles[i]!.t = "forest";
  }

  // Starts go on the biggest walkable region, away from the rim.
  const walk = components(tiles, size, (t) => walkable(t.t));
  const counts = new Map<number, number>();
  for (const id of walk) if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (main === undefined) return null;
  const candidates = rng.shuffle(
    tiles.flatMap((_, i) => {
      const r = rowOf(i, size);
      const c = colOf(i, size);
      return walk[i] === main && r >= 2 && c >= 2 && r < size - 2 && c < size - 2 ? [i] : [];
    }),
  );
  const starts = pickSpread(candidates, kinds.length, size);
  if (!starts) return null;

  starts.forEach((s, k) => shapeStart(tiles, s, kinds[k]!, size, rng));
  classifyWater(tiles, size);
  scatterResources(tiles, size, starts, rng, RESOURCE_SCALE[opts.resources]);
  if (!placeVillages(tiles, size, starts, rng)) return null;
  placeRuins(tiles, size, starts, rng);
  balanceStarts(tiles, size, starts, rng);
  return { tiles, starts };
}

/**
 * Farthest-point sampling over shuffled candidates: each pick maximises its
 * distance to those already chosen. Null if they can't all be MIN_START_DISTANCE apart.
 */
function pickSpread(candidates: number[], n: number, size: number): number[] | null {
  if (candidates.length < n) return null;
  const chosen = [candidates[0]!];
  while (chosen.length < n) {
    let best = -1;
    let bestDist = -1;
    for (const c of candidates) {
      const d = Math.min(...chosen.map((s) => chebyshev(s, c, size)));
      if (d > bestDist) {
        best = c;
        bestDist = d;
      }
    }
    if (bestDist < MIN_START_DISTANCE) return null;
    chosen.push(best);
  }
  return chosen;
}

/**
 * A start needs a growth path from turn one: its own tile flat and clear, and
 * two of its home resource inside the starting territory (radius 1).
 */
function shapeStart(tiles: Tile[], start: number, kind: FactionKind, size: number, rng: Rng): void {
  const home = FACTIONS[kind].homeResource;
  Object.assign(tiles[start]!, blank("plains"));
  const ring = rng.shuffle(neighbors(start, size));
  // At least five land neighbours, so the city isn't a cramped spit.
  let land = ring.filter((i) => TERRAIN[tiles[i]!.t].land).length;
  for (const i of ring) {
    if (land >= 5) break;
    if (!TERRAIN[tiles[i]!.t].land) {
      Object.assign(tiles[i]!, blank("plains"));
      land++;
    }
  }
  // Fish live in water: the coast gets two shallow bays at its door.
  const homeTerrain: Terrain = home === "animals" ? "forest" : home === "fish" ? "ocean" : "plains";
  let placed = 0;
  for (const i of ring) {
    if (placed >= 2) break;
    const t = tiles[i]!;
    if (home !== "fish" && (!TERRAIN[t.t].land || t.t === "mountain")) continue;
    Object.assign(t, blank(homeTerrain));
    t.res = home;
    placed++;
  }
  // Highlanders want a peak with ore nearby, for the Mining their start leads to.
  if (kind === "highland") {
    const peak = ring.find((i) => TERRAIN[tiles[i]!.t].land && !tiles[i]!.res);
    if (peak !== undefined) Object.assign(tiles[peak]!, blank("mountain"), { res: "ore" });
  }
  // A third, different resource keeps every faction's second tech useful.
  const spare = ring.find((i) => tiles[i]!.t === "plains" && !tiles[i]!.res);
  if (spare !== undefined) tiles[spare]!.res = "crops";
}

/** Water touching land is shallow; the rest is open ocean. */
function classifyWater(tiles: Tile[], size: number): void {
  tiles.forEach((t, i) => {
    if (TERRAIN[t.t].land) return;
    t.t = neighbors(i, size).some((j) => TERRAIN[tiles[j]!.t].land) ? "shallow" : "ocean";
  });
}

const RESOURCE_ODDS: Partial<Record<Terrain, [Resource, number][]>> = {
  plains: [["fruit", 0.1], ["crops", 0.08]],
  forest: [["animals", 0.18]],
  mountain: [["ore", 0.25]],
  shallow: [["fish", 0.15]],
};

function scatterResources(tiles: Tile[], size: number, starts: number[], rng: Rng, scale: number): void {
  const near = new Set(starts.flatMap((s) => area(s, 1, size)));
  tiles.forEach((t, i) => {
    if (near.has(i) || t.res) return;
    const roll = rng.next();
    let acc = 0;
    for (const [res, p] of RESOURCE_ODDS[t.t] ?? []) {
      acc += p * scale;
      if (roll < acc) {
        t.res = res;
        return;
      }
    }
  });
}

const farFrom = (i: number, others: number[], d: number, size: number) => others.every((o) => chebyshev(i, o, size) >= d);

function placeVillages(tiles: Tile[], size: number, starts: number[], rng: Rng): boolean {
  const walk = components(tiles, size, (t) => walkable(t.t));
  const villages: number[] = [];
  const ok = (i: number) =>
    walkable(tiles[i]!.t) && walk[i] === walk[starts[0]!] && farFrom(i, starts, 3, size) && farFrom(i, villages, 3, size);
  const put = (i: number) => {
    villages.push(i);
    tiles[i]!.feat = "village";
    tiles[i]!.res = null;
  };
  // Guaranteed one near every start first, then fill the rest of the map.
  for (const s of starts) {
    if (villages.some((v) => chebyshev(v, s, size) <= VILLAGE_REACH)) continue;
    const near = area(s, VILLAGE_REACH, size).filter(ok);
    if (!near.length) return false;
    put(rng.pick(near));
  }
  const land = tiles.filter((t) => TERRAIN[t.t].land).length;
  const target = Math.round(land / 14);
  for (const i of rng.shuffle(tiles.map((_, i) => i))) {
    if (villages.length >= target) break;
    if (ok(i)) put(i);
  }
  return true;
}

function placeRuins(tiles: Tile[], size: number, starts: number[], rng: Rng): void {
  const land = tiles.filter((t) => TERRAIN[t.t].land).length;
  const target = Math.max(1, Math.round(land / 45));
  const taken: number[] = [];
  for (const i of rng.shuffle(tiles.map((_, i) => i))) {
    if (taken.length >= target) break;
    const t = tiles[i]!;
    if (!TERRAIN[t.t].land || t.feat || !farFrom(i, starts, 3, size) || !farFrom(i, taken, 3, size)) continue;
    if (neighbors(i, size).some((j) => tiles[j]!.feat === "village")) continue;
    t.feat = "ruins";
    t.res = null;
    taken.push(i);
  }
}

/** Tops up thin starts with extra resources nearby, so fairness rarely costs a reroll. */
function balanceStarts(tiles: Tile[], size: number, starts: number[], rng: Rng): void {
  const max = Math.max(...starts.map((s) => startValue(tiles, s, size)));
  const fill: Partial<Record<Terrain, Resource[]>> = {
    plains: ["fruit", "crops"],
    forest: ["animals"],
    mountain: ["ore"],
    shallow: ["fish"],
  };
  for (const s of starts) {
    const spots = rng.shuffle(
      area(s, 3, size).filter((i) => chebyshev(i, s, size) >= 2 && !tiles[i]!.res && !tiles[i]!.feat && fill[tiles[i]!.t]),
    );
    for (const i of spots) {
      if (startValue(tiles, s, size) >= 0.8 * max) break;
      tiles[i]!.res = rng.pick(fill[tiles[i]!.t]!);
    }
  }
}

// ---------------------------------------------------------------------------
// Validation (§4): measurable constraints with tolerances, not symmetry.
// ---------------------------------------------------------------------------

const RESOURCE_VALUE: Record<Resource, number> = { fruit: 1, animals: 1, fish: 1, crops: 1.5, ore: 1.5 };

export function startValue(tiles: Tile[], start: number, size: number): number {
  let v = 0;
  for (const i of area(start, 3, size)) {
    const t = tiles[i]!;
    if (t.res) v += RESOURCE_VALUE[t.res];
    if (t.feat === "village") v += 2;
  }
  return v;
}

export interface StartReport {
  spacing: number;
  sameRegion: boolean;
  villageNear: boolean[];
  homeResources: number[];
  values: number[];
}

export function inspectStarts(tiles: Tile[], starts: number[], size: number): StartReport {
  const walk = components(tiles, size, (t) => walkable(t.t));
  let spacing = Infinity;
  for (let a = 0; a < starts.length; a++) {
    for (let b = a + 1; b < starts.length; b++) spacing = Math.min(spacing, chebyshev(starts[a]!, starts[b]!, size));
  }
  return {
    spacing,
    sameRegion: starts.every((s) => walk[s] === walk[starts[0]!] && walk[s] !== -1),
    villageNear: starts.map((s) =>
      area(s, VILLAGE_REACH, size).some((i) => tiles[i]!.feat === "village" && walk[i] === walk[s]),
    ),
    homeResources: starts.map(
      (s) => neighbors(s, size).filter((i) => tiles[i]!.res && HARVEST[tiles[i]!.res!]).length,
    ),
    values: starts.map((s) => startValue(tiles, s, size)),
  };
}

export function validateWorld(tiles: Tile[], starts: number[], size: number): boolean {
  const rep = inspectStarts(tiles, starts, size);
  const max = Math.max(...rep.values);
  const min = Math.min(...rep.values);
  return (
    (starts.length < 2 || rep.spacing >= MIN_START_DISTANCE) &&
    rep.sameRegion &&
    rep.villageNear.every(Boolean) &&
    rep.homeResources.every((n) => n >= 2) &&
    min >= FAIRNESS * max
  );
}

// ---------------------------------------------------------------------------
// Fallback: an island of plains with starts on a ring. Dull, but always legal.
// ---------------------------------------------------------------------------

export function templateWorld(size: number, kinds: FactionKind[]): Omit<World, "attempts" | "template"> {
  const tiles: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    const r = rowOf(i, size);
    const c = colOf(i, size);
    const edge = r === 0 || c === 0 || r === size - 1 || c === size - 1;
    tiles.push(blank(edge ? "ocean" : (r * 7 + c * 3) % 9 === 0 ? "forest" : "plains"));
  }
  const mid = (size - 1) / 2;
  const radius = mid - 3;
  const starts = kinds.map((_, k) => {
    const a = (2 * Math.PI * k) / kinds.length;
    return indexOf(Math.round(mid + radius * Math.sin(a)), Math.round(mid + radius * Math.cos(a)), size);
  });
  const rng = new Rng(1);
  starts.forEach((s, k) => shapeStart(tiles, s, kinds[k]!, size, rng));
  classifyWater(tiles, size);
  // Villages between each start and the centre.
  const centre = indexOf(Math.round(mid), Math.round(mid), size);
  for (const s of starts) {
    const r = Math.round((rowOf(s, size) * 3 + rowOf(centre, size) * 2) / 5);
    const c = Math.round((colOf(s, size) * 3 + colOf(centre, size) * 2) / 5);
    const v = tiles[indexOf(r, c, size)]!;
    if (!starts.includes(indexOf(r, c, size))) Object.assign(v, blank("plains"), { feat: "village" });
  }
  return { tiles, starts };
}
