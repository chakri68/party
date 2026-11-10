import { describe, expect, it } from "vitest";
import { TEMPLATES, pieceLabel, worldSlot, type SetPiece, type TreasureLayout } from "../shared/index.ts";
import { makeHunt } from "../server/hunt.ts";
import type { Cache } from "../server/caches.ts";

const LANDMARK_FILLER = /^[A-Z][^.]*\.$/;
const RELATIONAL = /^Between the (.+) and the (.+), nearer the (.+)\.$/;
const BEARING = /^About (\d+) m from the (.+), at (\d+)°\.$/;

type Kind = "landmark" | "relational" | "bearing";
const DIFFICULTY: Record<Kind, 1 | 2 | 3> = { landmark: 1, relational: 2, bearing: 3 };

/** The one piece with this label. Fails if none or more than one has it. */
function byLabel(l: TreasureLayout, label: string): SetPiece {
  const hits = l.pieces.filter((p) => pieceLabel(p) === label);
  expect(hits, `label "${label}"`).toHaveLength(1);
  return hits[0]!;
}

/** Check one clue against the map and return its kind. */
function checkClue(l: TreasureLayout, c: Cache, clue: string): Kind {
  const rel = RELATIONAL.exec(clue);
  if (rel) {
    const a = byLabel(l, rel[1]!);
    const b = byLabel(l, rel[2]!);
    const near = byLabel(l, rel[3]!);
    expect(a.id).not.toBe(b.id);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / (len * len);
    const off = Math.abs((c.x - a.x) * dz - (c.z - a.z) * dx) / len;
    expect(t).toBeGreaterThanOrEqual(0.2);
    expect(t).toBeLessThanOrEqual(0.8);
    expect(off).toBeLessThanOrEqual(0.25 * len);
    const da = Math.hypot(c.x - a.x, c.z - a.z);
    const db = Math.hypot(c.x - b.x, c.z - b.z);
    expect(near.id).toBe(da <= db ? a.id : b.id);
    return "relational";
  }
  const brg = BEARING.exec(clue);
  if (brg) {
    const d = Number(brg[1]);
    const p = byLabel(l, brg[2]!);
    const b = Number(brg[3]);
    expect(d % 50).toBe(0);
    expect(d).toBeGreaterThanOrEqual(50);
    expect(b % 10).toBe(0);
    expect(b).toBeLessThan(360);
    expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeLessThanOrEqual(600);
    const a = (b * Math.PI) / 180;
    const ex = p.x + Math.sin(a) * d;
    const ez = p.z - Math.cos(a) * d;
    expect(Math.hypot(ex - c.x, ez - c.z)).toBeLessThanOrEqual(60);
    return "bearing";
  }
  // Landmark: one of the source piece's own slot hints, at this cache's spot.
  expect(clue).toMatch(LANDMARK_FILLER);
  const p = l.pieces.find((q) => q.id === c.source);
  expect(p, `landmark clue "${clue}" on a non-piece cache`).toBeDefined();
  const slot = TEMPLATES[p!.template].slots(p!.params).find((s) => s.hint.replace("{label}", pieceLabel(p!)) === clue);
  expect(slot, clue).toBeDefined();
  const w = worldSlot(p!, slot!);
  expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeLessThan(1e-9);
  expect(clue).toContain(pieceLabel(p!));
  return "landmark";
}

describe("clues", () => {
  it("bearing text uses north −Z and east +X", () => {
    // Seed 42 must hold at least one bearing clue; check it by hand once.
    const { layout, caches } = makeHunt(42);
    const c = caches.find((k) => k.clues.some((t) => BEARING.test(t)));
    expect(c).toBeDefined();
    const m = BEARING.exec(c!.clues.find((t) => BEARING.test(t))!)!;
    const p = byLabel(layout, m[2]!);
    const raw = ((Math.atan2(c!.x - p.x, -(c!.z - p.z)) * 180) / Math.PI + 360) % 360;
    expect((Math.round(raw / 10) * 10) % 360).toBe(Number(m[3]));
  });

  it("1000 seeds: 1–2 clues of different kinds, true to the map, difficulty is the easiest", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const { layout: l, caches } = makeHunt(seed);
      for (const c of caches) {
        expect(c.clues.length).toBeGreaterThanOrEqual(1);
        expect(c.clues.length).toBeLessThanOrEqual(2);
        const kinds = c.clues.map((t) => checkClue(l, c, t));
        expect(new Set(kinds).size).toBe(kinds.length);
        expect(c.difficulty).toBe(Math.min(...kinds.map((k) => DIFFICULTY[k])));
      }
    }
  }, 120_000);
});
