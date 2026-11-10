import { describe, expect, it } from "vitest";
import { cellSlope, generateLayout, macroHeight, makeLayout, rng, validateLayout } from "../shared/index.ts";
import { CACHE_BOUND, CACHE_MAX_SLOPE, cacheSpots, makeCaches } from "../server/caches.ts";
import { makeHunt } from "../server/hunt.ts";

describe("makeHunt", () => {
  it("is deterministic", () => {
    expect(makeHunt(42)).toEqual(makeHunt(42));
  });

  it("200 seeds: keeps makeLayout's layout unless the caches rerolled it", () => {
    let same = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const h = makeHunt(seed);
      const l = makeLayout(seed);
      if (h.layout.seed === l.seed) {
        expect(h.layout).toEqual(l);
        same++;
      } else {
        // Only a cache failure may move us past makeLayout's pick.
        expect(makeCaches(l, rng(l.seed ^ 0xcac4e))).toBeNull();
        expect(h.layout.seed).toBeGreaterThan(l.seed);
      }
    }
    expect(same).toBeGreaterThan(190);
  }, 60_000);

  it("returns null when there are fewer than 20 valid spots", () => {
    const l = generateLayout(1);
    expect(makeCaches({ ...l, pieces: [], minor: l.minor.slice(0, 5) }, rng(1))).toBeNull();
  });

  it("1000 seeds: never throws, 20–30 valid caches per map, about half from pieces", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const { layout: l, caches } = makeHunt(seed);
      expect(validateLayout(l)).toEqual([]);
      expect(caches.length).toBeGreaterThanOrEqual(20);
      expect(caches.length).toBeLessThanOrEqual(30);
      expect(caches.map((c) => c.id)).toEqual(caches.map((_, i) => `c${i}`));
      const pieceIds = new Set(l.pieces.map((p) => p.id));
      const minorIds = new Set(l.minor.map((m) => m.id));
      const fromPieces = caches.filter((c) => pieceIds.has(c.source)).length;
      const spots = cacheSpots(l);
      const pieceSpots = spots.filter((s) => pieceIds.has(s.source)).length;
      const minorSpots = spots.length - pieceSpots;
      const n = caches.length;
      expect(fromPieces).toBe(Math.min(pieceSpots, Math.max(Math.round(n / 2), n - minorSpots)));
      const keys = new Set<string>();
      for (const c of caches) {
        expect(pieceIds.has(c.source) || minorIds.has(c.source)).toBe(true);
        expect(macroHeight(l, c.x, c.z)).toBeGreaterThanOrEqual(0.5);
        expect(Math.abs(c.x)).toBeLessThanOrEqual(CACHE_BOUND);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(CACHE_BOUND);
        expect(cellSlope(l, c.x, c.z)).toBeLessThan(CACHE_MAX_SLOPE);
        expect(c.dy).toBeGreaterThanOrEqual(0);
        expect(c.dy).toBeLessThanOrEqual(1);
        keys.add(`${c.x},${c.z}`);
      }
      expect(keys.size).toBe(caches.length);
    }
  }, 120_000);
});
