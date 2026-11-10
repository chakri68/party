import { describe, expect, it } from "vitest";
import {
  BIOMES,
  TEMPLATES,
  generateLayout,
  macroHeight,
  makeLayout,
  pieceLabel,
  placePieces,
  rng,
  worldSlot,
  type SetPiece,
  type TemplateId,
  type TreasureLayout,
} from "../shared/index.ts";

const IDS = Object.keys(TEMPLATES) as TemplateId[];

// Parameter ranges from the M2 brief, checked against each roll.
const RANGES: Record<TemplateId, Record<string, [number, number]>> = {
  lighthouse: { height: [14, 22], ruined: [0, 1] },
  shipwreck: { length: [12, 20], buried: [0, 0.5], tilt: [-20, 20] },
  "stone-circle": { stones: [6, 12], fallen: [0, 3] },
  "radio-tower": { height: [20, 35], wires: [0, 1] },
  camp: { tents: [1, 3], firepit: [0, 1] },
  plane: { debris: [10, 30], heading: [0, 2 * Math.PI] },
};
const BOOLS = new Set(["ruined", "wires", "firepit"]);
const INTS = new Set(["stones", "fallen", "tents", "debris"]);

/** Macro vertices as [x, z, height m, biome name]. */
function vertices(l: TreasureLayout): [number, number, number, string][] {
  const { origin, cell, size, heights, biomes } = l.macro;
  const out: [number, number, number, string][] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      out.push([origin + i * cell, origin + j * cell, heights[j * size + i]! / 10, BIOMES[biomes[j * size + i]!]!]);
    }
  }
  return out;
}

/** Biome of the vertex nearest (x, z). */
function biomeAt(l: TreasureLayout, x: number, z: number): string {
  const { origin, cell, size, biomes } = l.macro;
  const i = Math.round((x - origin) / cell);
  const j = Math.round((z - origin) / cell);
  return BIOMES[biomes[j * size + i]!]!;
}

/**
 * Highest minus lowest macro height over the pad: its centre and 8 points on
 * its rim. Re-derived here rather than imported from sites.ts, so the test
 * checks the rule on its own terms.
 */
function padSpread(l: TreasureLayout, p: SetPiece): number {
  const hs = [macroHeight(l, p.x, p.z)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    hs.push(macroHeight(l, p.x + Math.cos(a) * p.padR, p.z + Math.sin(a) * p.padR));
  }
  return Math.max(...hs) - Math.min(...hs);
}

describe("TEMPLATES", () => {
  it("every template rolls params in range and gives 2–4 slots with 0 ≤ dy ≤ 1", () => {
    expect([...IDS].sort()).toEqual(Object.keys(RANGES).sort());
    for (const id of IDS) {
      const t = TEMPLATES[id];
      expect(t.id).toBe(id);
      expect(new Set(t.labels).size).toBe(3);
      const r = rng(id.length * 977);
      for (let n = 0; n < 50; n++) {
        const params = t.roll(r);
        expect(Object.keys(params).sort()).toEqual(Object.keys(RANGES[id]).sort());
        for (const [k, [lo, hi]] of Object.entries(RANGES[id])) {
          const v = params[k]!;
          expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(lo);
          expect(v, `${id}.${k}`).toBeLessThanOrEqual(hi);
          if (BOOLS.has(k)) expect([0, 1]).toContain(v);
          if (INTS.has(k)) expect(Number.isInteger(v)).toBe(true);
        }
        const slots = t.slots(params);
        expect(slots.length).toBeGreaterThanOrEqual(2);
        expect(slots.length).toBeLessThanOrEqual(4);
        for (const s of slots) {
          expect([0, 0.5, 1]).toContain(s.dy);
          expect(s.hint).toContain("{label}");
          // On the pad, so the pad height holds under it.
          expect(Math.hypot(s.x, s.z)).toBeLessThan(t.padR);
        }
      }
    }
  });
});

describe("placePieces", () => {
  it("keeps the spacing, bounds and site rules", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const l = generateLayout(seed);
      const pieces = placePieces(l, rng(seed ^ 0x5e7));
      expect(pieces).toEqual(l.pieces);
      const vs = vertices(l);
      const seaSide = l.ring.includes("sea");
      const counts: Record<string, Set<number>> = {};
      pieces.forEach((p, i) => {
        const where = `seed ${seed} ${p.id} ${p.template} at (${p.x}, ${p.z})`;
        expect(p.id).toBe(`p${i}`);
        expect(p.padR).toBe(TEMPLATES[p.template].padR);
        expect(Math.abs(p.x), where).toBeLessThanOrEqual(690);
        expect(Math.abs(p.z), where).toBeLessThanOrEqual(690);
        const h = macroHeight(l, p.x, p.z);
        expect(h, where).toBeGreaterThanOrEqual(0.5);
        expect(p.padY).toBeCloseTo(Math.round(h * 10) / 10, 9);
        expect(Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z), where).toBeGreaterThanOrEqual(60);
        for (const q of pieces.slice(0, i)) {
          expect(Math.hypot(p.x - q.x, p.z - q.z), where).toBeGreaterThanOrEqual(150);
        }
        (counts[p.template] ??= new Set()).add(p.variant);
        expect([0, 1, 2]).toContain(p.variant);

        const near = (d: number) => vs.filter(([x, z]) => Math.hypot(x - p.x, z - p.z) <= d);
        switch (p.template) {
          case "lighthouse":
            expect(seaSide, where).toBe(true);
            expect(near(120).some((v) => v[2] < 0), where).toBe(true);
            expect(h, where).toBeGreaterThanOrEqual(8);
            break;
          case "shipwreck":
            expect(near(40).some((v) => v[2] < 0), where).toBe(true);
            expect(h, where).toBeGreaterThanOrEqual(0.5);
            expect(h, where).toBeLessThanOrEqual(4);
            break;
          case "stone-circle":
            expect(biomeAt(l, p.x, p.z), where).toBe("meadow");
            expect(padSpread(l, p), where).toBeLessThanOrEqual(2);
            break;
          case "radio-tower":
            expect(near(150).every((v) => v[2] <= h), where).toBe(true);
            break;
          case "camp":
            expect(biomeAt(l, p.x, p.z), where).toBe("forest");
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
          case "plane":
            expect(["forest", "snowcap"]).not.toContain(biomeAt(l, p.x, p.z));
            expect(padSpread(l, p), where).toBeLessThanOrEqual(3);
            break;
        }
      });
      // At most 3 of a kind, each with its own label.
      for (const t of IDS) {
        const n = pieces.filter((p) => p.template === t).length;
        expect(n).toBeLessThanOrEqual(3);
        expect(counts[t]?.size ?? 0).toBe(n);
      }
    }
  }, 30_000);

  it("pieceLabel names the kind with its label word", () => {
    const p = makeLayout(1).pieces[0]!;
    const t = TEMPLATES[p.template];
    expect(pieceLabel(p)).toBe(`${t.labels[p.variant]} ${t.name}`);
    expect(pieceLabel({ ...p, template: "lighthouse", variant: 0 })).toBe("red lighthouse");
  });
});

describe("worldSlot", () => {
  it("worldSlot rotates by yaw", () => {
    const p: SetPiece = {
      id: "p0", template: "camp", x: 0, z: 0, yaw: Math.PI / 2, padY: 3, padR: 14, variant: 0, params: {},
    };
    const w = worldSlot(p, { x: 2, z: 0, dy: 0.5, hint: "" });
    expect(w.x).toBeCloseTo(0, 9);
    expect(w.z).toBeCloseTo(-2, 9);
    expect(w.dy).toBe(0.5);
    const q = worldSlot({ ...p, x: 100, z: -50, yaw: 0 }, { x: 2, z: 3, dy: 0, hint: "" });
    expect(q).toEqual({ x: 102, z: -47, dy: 0 });
  });
});

describe("1000 seeds", () => {
  it("1000 seeds: makeLayout never fails and every map has 10–14 pieces", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const l = makeLayout(seed);
      expect(l.version).toBe(2);
      expect(l.pieces.length, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(l.pieces.length, `seed ${seed}`).toBeLessThanOrEqual(14);
    }
  }, 60_000);
});
