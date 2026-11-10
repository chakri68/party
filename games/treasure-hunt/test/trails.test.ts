import { cellSlope } from "../shared/generate.ts";
import { describe, expect, it } from "vitest";
import {
  BIOMES,
  MINOR_KINDS,
  kindFor,
  MINOR_SLOT,
  TRAIL_HALF_WIDTH,
  generateLayout,
  macroHeight,
  makeLayout,
  makeTrails,
  unjoinedPieces,
  placeMinor,
  rng,
  validateLayout,
  type TreasureLayout,
} from "../shared/index.ts";

/** Distance from (x, z) to the nearest trail segment. */
function trailDist(l: TreasureLayout, x: number, z: number): number {
  let best = Infinity;
  for (const t of l.trails) {
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

const nodes = (l: TreasureLayout) => [
  { x: l.spawn.x, z: l.spawn.z, r: 0 },
  ...l.pieces.map((p) => ({ x: p.x, z: p.z, r: p.padR })),
];

describe("trails and minor points", () => {
  it("is deterministic, and layers 1–3 do not move", () => {
    const a = generateLayout(7);
    const b = generateLayout(7);
    expect(a.trails).toEqual(b.trails);
    expect(a.minor).toEqual(b.minor);
    expect(makeTrails(a, rng(7 ^ 0x7a11))).toEqual(a.trails);
    expect(placeMinor(a, rng(7 ^ 0x3140))).toEqual(a.minor);
  });

  it("has the exact slot hints", () => {
    expect(MINOR_SLOT.rocks.hint).toBe("Beside a pile of rocks.");
    expect(MINOR_SLOT.log.hint).toBe("Beside a fallen log.");
    expect(MINOR_SLOT.campfire.hint).toBe("Next to an old campfire.");
    expect(MINOR_SLOT.shed).toMatchObject({ x: 2.2, z: 0, hint: "Beside an old shed." });
    expect(MINOR_SLOT.barrels).toMatchObject({ x: 1.2, z: 0, hint: "Beside some old barrels." });
    expect(MINOR_SLOT.signpost).toMatchObject({ x: 1.2, z: 0, hint: "At the foot of a signpost." });
    expect(MINOR_SLOT.woodpile).toMatchObject({ x: 1.5, z: 0, hint: "Beside a stack of logs." });
    expect(MINOR_SLOT.cart).toMatchObject({ x: 1.4, z: 0, hint: "Next to an old cart." });
    for (const s of Object.values(MINOR_SLOT)) expect(s.dy).toBe(0);
    expect(TRAIL_HALF_WIDTH).toBe(2);
  });

  it("200 seeds: trails are on land, evenly spaced, and end at a pad edge", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const l = makeLayout(seed);
      const ns = nodes(l);
      for (const t of l.trails) {
        const where = `seed ${seed}`;
        expect(t.pts.length, where).toBeGreaterThanOrEqual(2);
        for (const [x, z] of t.pts) {
          expect(macroHeight(l, x, z), `${where} (${x}, ${z})`).toBeGreaterThanOrEqual(1);
          expect(Math.round(x * 10) / 10).toBe(x);
          expect(Math.round(z * 10) / 10).toBe(z);
        }
        for (let i = 1; i < t.pts.length; i++) {
          const d = Math.hypot(t.pts[i]![0] - t.pts[i - 1]![0], t.pts[i]![1] - t.pts[i - 1]![1]);
          expect(d, `${where} step ${i}`).toBeGreaterThanOrEqual(12);
          expect(d, `${where} step ${i}`).toBeLessThanOrEqual(20);
          const rise = Math.abs(macroHeight(l, t.pts[i]![0], t.pts[i]![1]) - macroHeight(l, t.pts[i - 1]![0], t.pts[i - 1]![1]));
          expect(rise / d, `${where} slope ${i}`).toBeLessThanOrEqual(Math.tan((30 * Math.PI) / 180) + 1e-9);
        }
        for (const end of [t.pts[0]!, t.pts[t.pts.length - 1]!]) {
          const ok = ns.some((n) => Math.hypot(end[0] - n.x, end[1] - n.z) <= n.r + 4);
          expect(ok, `${where} end (${end})`).toBe(true);
        }
      }
    }
  }, 30_000);

  it("200 seeds: minor points keep their spacing and sit on gentle land", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const l = makeLayout(seed);
      l.minor.forEach((m, i) => {
        const where = `seed ${seed} ${m.id}`;
        expect(m.id).toBe(`m${i}`);
        expect(Math.abs(m.x)).toBeLessThanOrEqual(720);
        expect(Math.abs(m.z)).toBeLessThanOrEqual(720);
        expect(macroHeight(l, m.x, m.z), where).toBeGreaterThanOrEqual(1);
        for (const o of l.minor.slice(0, i)) expect(Math.hypot(m.x - o.x, m.z - o.z), where).toBeGreaterThanOrEqual(35);
        for (const p of l.pieces) expect(Math.hypot(m.x - p.x, m.z - p.z), where).toBeGreaterThanOrEqual(p.padR + 20);
        expect(trailDist(l, m.x, m.z), where).toBeGreaterThanOrEqual(6);
        expect(cellSlope(l, m.x, m.z), where).toBeLessThan(Math.tan((25 * Math.PI) / 180));
      });
    }
  }, 30_000);

  it("1000 seeds: 60–80 minor points, few pieces are unjoined, kinds follow biomes", () => {
    let unjoined = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const l = makeLayout(seed);
      expect(validateLayout(l), `seed ${seed}`).toEqual([]);
      expect(l.minor.length, `seed ${seed}`).toBeGreaterThanOrEqual(60);
      expect(l.minor.length, `seed ${seed}`).toBeLessThanOrEqual(80);
      const n = unjoinedPieces(l).length;
      unjoined += n;
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(3);
      const { origin, cell, size, biomes } = l.macro;
      for (const m of l.minor) {
        const i = Math.round((m.x - origin) / cell);
        const j = Math.round((m.z - origin) / cell);
        const b = BIOMES[biomes[j * size + i]!];
        expect(MINOR_KINDS[b!], `seed ${seed} ${m.id}`).toContain(m.kind);
      }
    }
    expect(unjoined / 1000).toBeLessThan(0.5);
  }, 30_000);

  it("200 seeds: every kind shows on at least half the maps, and kindFor keeps to its biome", () => {
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const l = makeLayout(seed);
      for (const k of new Set(l.minor.map((m) => m.kind))) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const k of Object.keys(MINOR_SLOT)) expect(seen.get(k) ?? 0, k).toBeGreaterThanOrEqual(100);
    for (const b of BIOMES) {
      const r = rng(3);
      for (let i = 0; i < 200; i++) expect(MINOR_KINDS[b]).toContain(kindFor(b, r));
    }
    expect(MINOR_KINDS.meadow.length).toBe(8);
  }, 30_000);
});
