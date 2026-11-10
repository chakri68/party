// Layer 6 (§4.2, §6.1): where the caches hide. Every piece slot and every
// minor point's slot is a candidate; the ones on land, inside the play area
// and not on a cliff are kept, and 20–30 of those become caches. Server only:
// the client never learns where a cache is until it's close (R1).

import { cellSlope, macroHeight } from "../shared/generate.ts";
import { MINOR_SLOT } from "../shared/minor.ts";
import type { Rng } from "../shared/noise.ts";
import { TEMPLATES, worldSlot } from "../shared/templates.ts";
import type { TreasureLayout } from "../shared/types.ts";
import { clueKinds, clueTexts, cluesFor, rateClues, type ClueKind } from "./clues.ts";

export interface Cache {
  /** "c0", "c1", … */
  id: string;
  x: number;
  z: number;
  /** Metres above the ground or pad, 0–1 (R7). */
  dy: number;
  /** The piece ("p3") or minor point ("m12") the slot belongs to. */
  source: string;
  difficulty: 1 | 2 | 3;
  clues: string[];
}

export type CacheSpot = Omit<Cache, "id" | "clues" | "difficulty">;

export const CACHE_MIN = 20;
export const CACHE_MAX = 30;
export const CACHE_BOUND = 730;
export const CACHE_MIN_HEIGHT = 0.5;
/** tan 35°, as rise per metre. */
export const CACHE_MAX_SLOPE = Math.tan((35 * Math.PI) / 180);

/**
 * Every candidate spot that can hold a cache: on land, in bounds, not too
 * steep, and with at least one clue kind that can point at it.
 * Pieces first, then minor points, each in layout order.
 */
export function cacheSpots(l: TreasureLayout): CacheSpot[] {
  const all: CacheSpot[] = [];
  for (const p of l.pieces) {
    for (const s of TEMPLATES[p.template].slots(p.params)) all.push({ ...worldSlot(p, s), source: p.id });
  }
  for (const m of l.minor) all.push({ ...worldSlot(m, MINOR_SLOT[m.kind]), source: m.id });
  return all.filter(
    (s) =>
      Math.abs(s.x) <= CACHE_BOUND &&
      Math.abs(s.z) <= CACHE_BOUND &&
      macroHeight(l, s.x, s.z) >= CACHE_MIN_HEIGHT &&
      cellSlope(l, s.x, s.z) < CACHE_MAX_SLOPE &&
      clueKinds(l, s).length > 0,
  );
}

/** Fisher–Yates, in place. */
function shuffle<T>(a: T[], r: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** How often makeCaches had to step in to keep clue lists unique. */
export interface CacheTally {
  /** A repeat list fixed by adding a second clue. */
  second: number;
  /** A spot dropped because no second clue made it unique. */
  dropped: number;
}

/**
 * Pick 20–30 caches, about half from pieces, and give each its clues.
 * No two caches share a clue list, so a clue dealt to one player never
 * points at another player's cache. Null when fewer than 20 spots are valid
 * (R6), or too few are left after dropping repeats.
 */
export function makeCaches(l: TreasureLayout, r: Rng, tally?: CacheTally): Cache[] | null {
  const spots = cacheSpots(l);
  if (spots.length < CACHE_MIN) return null;
  const pieceIds = new Set(l.pieces.map((p) => p.id));
  const fromPieces = shuffle(spots.filter((s) => pieceIds.has(s.source)), r);
  const fromMinor = shuffle(spots.filter((s) => !pieceIds.has(s.source)), r);
  const n = Math.min(spots.length, CACHE_MIN + Math.floor(r() * (CACHE_MAX - CACHE_MIN + 1)));
  // Half from pieces, but fall back on whichever side has spots to spare.
  const np = Math.min(fromPieces.length, Math.max(Math.round(n / 2), n - fromMinor.length));
  // Mixed so a cache's id doesn't say where it came from.
  const queue = shuffle([...fromPieces.splice(0, np), ...fromMinor.splice(0, n - np)], r);

  const seen = new Set<string>();
  const out: Cache[] = [];
  while (queue.length > 0) {
    const s = queue.shift()!;
    const spot = { id: `c${out.length}`, ...s };
    let got = cluesFor(l, spot, r);
    if (seen.has(got.clues.join("\n"))) {
      got = unique(l, spot, got.clues, seen, r) ?? got;
      if (seen.has(got.clues.join("\n"))) {
        // Replace it from the same side when we can, so the split holds.
        const spare = pieceIds.has(s.source) ? (fromPieces.shift() ?? fromMinor.shift()) : (fromMinor.shift() ?? fromPieces.shift());
        if (spare) queue.unshift(spare);
        if (tally) tally.dropped++;
        continue;
      }
      if (tally) tally.second++;
    }
    seen.add(got.clues.join("\n"));
    out.push({ ...spot, ...got });
  }
  return out.length < CACHE_MIN ? null : out;
}

/** A second clue of another kind that makes this one-clue list new, or null. */
function unique(l: TreasureLayout, s: CacheSpot, clues: string[], seen: Set<string>, r: Rng): Pick<Cache, "clues" | "difficulty"> | null {
  if (clues.length !== 1) return null;
  const texts = clueTexts(l, s);
  const have = [...texts].find(([, t]) => t === clues[0])![0];
  const others = shuffle([...texts.keys()].filter((k) => k !== have), r);
  for (const k of others) {
    const got = rateClues(l, s, [have, k] as ClueKind[]);
    if (!seen.has(got.clues.join("\n"))) return got;
  }
  return null;
}
