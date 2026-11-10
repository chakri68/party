// Layer 7 (§6.2): clues, built only from facts the generator knows, easiest first:
//   landmark   the slot's own hint, for piece slots only.
//   relational between two pieces, nearer one of them.
//   lamp       a lit ground lamp over a piece slot, when the round gets dark.
//   bearing    a distance and a compass bearing from a nearby piece.
//   shadow     where a tall piece's shadow ends at a clock time in the round.
// Light clues (lamp, shadow) only go out when they'll be true during the
// round's clock window, so every clue builder takes the sky.

import { LAMP_REACH, SHADOW_MIN_EL, SHADOW_STEP, clockText, darkWithin, shadowTip, sunAt } from "../shared/sky.ts";
import type { Rng } from "../shared/noise.ts";
import { TEMPLATES, pieceLabel, worldLamp, worldSlot } from "../shared/templates.ts";
import type { SetPiece, TreasureLayout } from "../shared/types.ts";
import type { Cache, CacheSpot } from "./caches.ts";
import type { HuntSky } from "./hunt.ts";

export type ClueKind = "landmark" | "relational" | "bearing" | "shadow" | "lamp";
export const CLUE_DIFFICULTY: Record<ClueKind, 1 | 2 | 3> = { landmark: 1, relational: 2, bearing: 3, shadow: 3, lamp: 2 };
export const LIGHT_KINDS: readonly ClueKind[] = ["shadow", "lamp"];

/** Relational: the cache's projection onto AB lands in this part of it… */
export const REL_T_MIN = 0.2;
export const REL_T_MAX = 0.8;
/** …and is no further than this share of |AB| off the line. */
export const REL_OFFSET = 0.25;
/** Bearing: only from a piece this close. */
export const BEARING_MAX = 600;
/** A second clue, when a second kind fits. */
export const SECOND_CLUE = 0.4;

type Spot = Pick<Cache, "x" | "z" | "dy" | "source" | "shadowMin">;

/** A shadow tip has its piece as source but isn't at it. */
const atPiece = (l: TreasureLayout, s: Spot) => s.shadowMin === undefined && l.pieces.some((p) => p.id === s.source);

/** A shadow tip keeps this far (XZ) from every minor point. */
export const SHADOW_MINOR_GAP = 3;
/** …and this far beyond every piece's pad. */
export const SHADOW_PAD_GAP = 1;

/** Not on a piece's pad or at a minor point, where a cache would sit inside something. */
function clearTip(l: TreasureLayout, t: { x: number; z: number }): boolean {
  // Every piece, its own too: the tip is ≥ 10 m out, so that one never trips.
  if (l.pieces.some((p) => Math.hypot(t.x - p.x, t.z - p.z) <= p.padR + SHADOW_PAD_GAP)) return false;
  return !l.minor.some((m) => Math.hypot(t.x - m.x, t.z - m.z) <= SHADOW_MINOR_GAP);
}

/**
 * One spot per piece with a `top`: the tip of its shadow at a clock minute in
 * the window, a whole SHADOW_STEP, picked by `r`. A minute whose tip lands on
 * a pad or a minor point is skipped. A piece with no usable minute in the
 * window (sun too low, shadow too long, tip blocked) gives nothing.
 */
export function shadowSpots(l: TreasureLayout, sky: HuntSky, r: Rng): CacheSpot[] {
  const out: CacheSpot[] = [];
  const first = Math.ceil(sky.startMin / SHADOW_STEP) * SHADOW_STEP;
  for (const p of l.pieces) {
    const top = TEMPLATES[p.template].top?.(p.params);
    if (top === undefined) continue;
    const ok: { m: number; x: number; z: number }[] = [];
    for (let m = first; m <= sky.startMin + sky.minutes; m += SHADOW_STEP) {
      if (sunAt(m).el < SHADOW_MIN_EL) continue;
      const tip = shadowTip(p, top, m);
      if (tip && clearTip(l, tip)) ok.push({ m, ...tip });
    }
    if (ok.length === 0) continue;
    const pick = ok[Math.floor(r() * ok.length)]!;
    out.push({ x: pick.x, z: pick.z, dy: 0, source: p.id, shadowMin: pick.m });
  }
  return out;
}

/** The slot hint of the piece this spot sits at, with the label filled in. */
function landmark(l: TreasureLayout, s: Spot): string | null {
  if (s.shadowMin !== undefined) return null;
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
 * be a landmark clue posing as a hard one. A shadow tip sits 10–100 m out
 * from its piece, so that piece counts.
 */
function bearing(l: TreasureLayout, s: Spot): string | null {
  let best: SetPiece | null = null;
  let bestD = BEARING_MAX;
  for (const p of l.pieces) {
    if (s.shadowMin === undefined && p.id === s.source) continue;
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

/** A shadow spot only, at its own minute. */
function shadow(l: TreasureLayout, s: Spot): string | null {
  if (s.shadowMin === undefined) return null;
  const p = l.pieces.find((q) => q.id === s.source);
  return p ? `Where the shadow of the ${pieceLabel(p)} ends at ${clockText(s.shadowMin)}.` : null;
}

/** A piece slot under one of its ground lamps, when the round gets dark enough for it to count. */
function lamp(l: TreasureLayout, s: Spot, sky: HuntSky): string | null {
  if (s.shadowMin !== undefined) return null;
  const p = l.pieces.find((q) => q.id === s.source);
  const lamps = p && TEMPLATES[p.template].lamps?.(p.params);
  if (!p || !lamps) return null;
  const lit = lamps.some((k) => {
    if (!k.clue) return false;
    const w = worldLamp(p, k);
    return Math.hypot(w.x - s.x, w.z - s.z) <= LAMP_REACH;
  });
  // darkWithin walks the window minute by minute, so check it last.
  if (!lit || !darkWithin(sky.startMin, sky.minutes)) return null;
  return `Under the lamp at the ${pieceLabel(p)}. It comes on when it gets dark.`;
}

const BUILD: Record<ClueKind, (l: TreasureLayout, s: Spot, sky: HuntSky) => string | null> = {
  landmark,
  relational,
  bearing,
  shadow,
  lamp,
};
const KINDS: ClueKind[] = ["landmark", "relational", "bearing", "lamp", "shadow"];

/** Every clue that fits this spot, by kind. */
export function clueTexts(l: TreasureLayout, s: Spot, sky: HuntSky): Map<ClueKind, string> {
  const texts = new Map<ClueKind, string>();
  for (const k of KINDS) {
    const t = BUILD[k](l, s, sky);
    if (t) texts.set(k, t);
  }
  return texts;
}

/** The clue kinds that can point at this spot. */
export function clueKinds(l: TreasureLayout, s: Spot, sky: HuntSky): ClueKind[] {
  return [...clueTexts(l, s, sky).keys()];
}

/**
 * These kinds' clues, easiest first, and the difficulty: the easiest kind,
 * but never 3 at a piece. Any area a bearing or relational clue draws holds
 * the whole piece, and a piece has only 2–4 slots to check once you're there.
 */
export function rateClues(
  l: TreasureLayout,
  s: Spot,
  kinds: ClueKind[],
  sky: HuntSky,
  lead?: ClueKind,
): { clues: string[]; difficulty: 1 | 2 | 3 } {
  const texts = clueTexts(l, s, sky);
  // `lead` goes first whatever its difficulty: the light clue a quota spot was picked for.
  const rank = (k: ClueKind) => (k === lead ? 0 : CLUE_DIFFICULTY[k]);
  const sorted = [...kinds].sort((a, b) => rank(a) - rank(b));
  const easiest = Math.min(...kinds.map((k) => CLUE_DIFFICULTY[k])) as 1 | 2 | 3;
  return { clues: sorted.map((k) => texts.get(k)!), difficulty: atPiece(l, s) ? (Math.min(easiest, 2) as 1 | 2) : easiest };
}

/** One clue, or two of different kinds (p = 0.4). With `lead`, that kind is always the first. */
export function cluesFor(
  l: TreasureLayout,
  c: Omit<Cache, "clues" | "difficulty">,
  sky: HuntSky,
  r: Rng,
  lead?: ClueKind,
): { clues: string[]; difficulty: 1 | 2 | 3 } {
  const pool = clueKinds(l, c, sky);
  if (pool.length === 0) throw new Error(`no clue fits cache ${c.id}`);
  const count = pool.length > 1 && r() < SECOND_CLUE ? 2 : 1;
  const chosen: ClueKind[] = [];
  if (lead) {
    if (!pool.includes(lead)) throw new Error(`no ${lead} clue fits cache ${c.id}`);
    chosen.push(pool.splice(pool.indexOf(lead), 1)[0]!);
  }
  while (chosen.length < count) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  return rateClues(l, c, chosen, sky, lead);
}
