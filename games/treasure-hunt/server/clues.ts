// Layer 7 (§6.2): clues, built only from facts the generator knows. Three
// kinds for now, easiest first:
//   landmark   the slot's own hint, for piece slots only.
//   relational between two pieces, nearer one of them.
//   bearing    a distance and a compass bearing from a nearby piece.

import type { Rng } from "../shared/noise.ts";
import { TEMPLATES, pieceLabel, worldSlot } from "../shared/templates.ts";
import type { SetPiece, TreasureLayout } from "../shared/types.ts";
import type { Cache } from "./caches.ts";

export type ClueKind = "landmark" | "relational" | "bearing";
export const CLUE_DIFFICULTY: Record<ClueKind, 1 | 2 | 3> = { landmark: 1, relational: 2, bearing: 3 };

/** Relational: the cache's projection onto AB lands in this part of it… */
export const REL_T_MIN = 0.2;
export const REL_T_MAX = 0.8;
/** …and is no further than this share of |AB| off the line. */
export const REL_OFFSET = 0.25;
/** Bearing: only from a piece this close. */
export const BEARING_MAX = 600;
/** A second clue, when a second kind fits. */
export const SECOND_CLUE = 0.4;

type Spot = Pick<Cache, "x" | "z" | "dy" | "source">;

/** The slot hint of the piece this spot sits at, with the label filled in. */
function landmark(l: TreasureLayout, s: Spot): string | null {
  const p = l.pieces.find((q) => q.id === s.source);
  if (!p) return null;
  for (const slot of TEMPLATES[p.template].slots(p.params)) {
    const w = worldSlot(p, slot);
    if (Math.hypot(w.x - s.x, w.z - s.z) < 0.01) return slot.hint.replace("{label}", pieceLabel(p));
  }
  return null;
}

/** The shortest pair of pieces the spot sits between, or null. */
function relational(l: TreasureLayout, s: Spot): string | null {
  let best: { a: SetPiece; b: SetPiece; len: number } | null = null;
  const ps = l.pieces;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!;
      const b = ps[j]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len === 0 || (best && len >= best.len)) continue;
      const t = ((s.x - a.x) * dx + (s.z - a.z) * dz) / (len * len);
      const off = Math.abs((s.x - a.x) * dz - (s.z - a.z) * dx) / len;
      if (t >= REL_T_MIN && t <= REL_T_MAX && off <= REL_OFFSET * len) best = { a, b, len };
    }
  }
  if (!best) return null;
  const { a, b } = best;
  const near = Math.hypot(s.x - a.x, s.z - a.z) <= Math.hypot(s.x - b.x, s.z - b.z) ? a : b;
  return `Between the ${pieceLabel(a)} and the ${pieceLabel(b)}, nearer the ${pieceLabel(near)}.`;
}

/**
 * From the nearest piece within 600 m, not counting the piece the cache sits
 * at: "about 50 m from the lighthouse" when it's by the lighthouse door would
 * be a landmark clue posing as a hard one.
 */
function bearing(l: TreasureLayout, s: Spot): string | null {
  let best: SetPiece | null = null;
  let bestD = BEARING_MAX;
  for (const p of l.pieces) {
    if (p.id === s.source) continue;
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  if (!best) return null;
  const deg = ((Math.atan2(s.x - best.x, -(s.z - best.z)) * 180) / Math.PI + 360) % 360;
  const b = (Math.round(deg / 10) * 10) % 360;
  const d = Math.max(50, Math.round(bestD / 50) * 50);
  return `About ${d} m from the ${pieceLabel(best)}, at ${b}°.`;
}

const BUILD: Record<ClueKind, (l: TreasureLayout, s: Spot) => string | null> = { landmark, relational, bearing };
const KINDS: ClueKind[] = ["landmark", "relational", "bearing"];

/** Every clue that fits this spot, by kind. */
export function clueTexts(l: TreasureLayout, s: Spot): Map<ClueKind, string> {
  const texts = new Map<ClueKind, string>();
  for (const k of KINDS) {
    const t = BUILD[k](l, s);
    if (t) texts.set(k, t);
  }
  return texts;
}

/** The clue kinds that can point at this spot, easiest first. */
export function clueKinds(l: TreasureLayout, s: Spot): ClueKind[] {
  return [...clueTexts(l, s).keys()];
}

/**
 * These kinds' clues, easiest first, and the difficulty: the easiest kind,
 * but never 3 at a piece. Any area a bearing or relational clue draws holds
 * the whole piece, and a piece has only 2–4 slots to check once you're there.
 */
export function rateClues(l: TreasureLayout, s: Spot, kinds: ClueKind[]): { clues: string[]; difficulty: 1 | 2 | 3 } {
  const texts = clueTexts(l, s);
  const sorted = [...kinds].sort((a, b) => CLUE_DIFFICULTY[a] - CLUE_DIFFICULTY[b]);
  const easiest = CLUE_DIFFICULTY[sorted[0]!];
  const atPiece = l.pieces.some((p) => p.id === s.source);
  return { clues: sorted.map((k) => texts.get(k)!), difficulty: atPiece ? (Math.min(easiest, 2) as 1 | 2) : easiest };
}

/** One clue, or two of different kinds (p = 0.4). */
export function cluesFor(l: TreasureLayout, c: Omit<Cache, "clues" | "difficulty">, r: Rng): { clues: string[]; difficulty: 1 | 2 | 3 } {
  const pool = clueKinds(l, c);
  if (pool.length === 0) throw new Error(`no clue fits cache ${c.id}`);
  const count = pool.length > 1 && r() < SECOND_CLUE ? 2 : 1;
  const chosen: ClueKind[] = [];
  for (let n = 0; n < count; n++) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  return rateClues(l, c, chosen);
}
