import { describe, expect, it } from "vitest";
import { PHOTO_TARGET, START_MIN, cellSlope, generateLayout, macroHeight, makeLayout, rng, validateLayout } from "../shared/index.ts";
import { CACHE_BOUND, CACHE_MAX_SLOPE, cacheSpots, makeCaches, type CacheTally } from "../server/caches.ts";
import { clueKinds } from "../server/clues.ts";
import { CACHE_SEED, makeHunt, type HuntSky } from "../server/hunt.ts";

const SKY: HuntSky = { startMin: START_MIN.day, minutes: 30 };
const SHADOW = /^Where the shadow of /;
const LAMP = /^Under the lamp at /;
const isLight = (t: string) => SHADOW.test(t) || LAMP.test(t);

/** Every cache rule, on one seed and sky. */
function checkHunt(seed: number, sky: HuntSky): void {
  const { layout: l, caches } = makeHunt(seed, sky);
  expect(validateLayout(l)).toEqual([]);
  expect(caches.length).toBeGreaterThanOrEqual(20);
  expect(caches.length).toBeLessThanOrEqual(30);
  expect(caches.map((c) => c.id)).toEqual(caches.map((_, i) => `c${i}`));
  const pieceIds = new Set(l.pieces.map((p) => p.id));
  const minorIds = new Set(l.minor.map((m) => m.id));
  const fromPieces = caches.filter((c) => pieceIds.has(c.source)).length;
  const spots = cacheSpots(l, sky);
  const pieceSpots = spots.filter((s) => pieceIds.has(s.source)).length;
  const minorSpots = spots.length - pieceSpots;
  const tally: CacheTally = { second: 0, dropped: 0 };
  expect(makeCaches(l, rng(l.seed ^ CACHE_SEED), sky, tally)).toEqual(caches);
  const n = caches.length;
  // A dropped repeat is replaced from its own side when it can be, else the other.
  const want = Math.min(pieceSpots, Math.max(Math.round(n / 2), n - minorSpots));
  expect(Math.abs(fromPieces - want)).toBeLessThanOrEqual(tally.dropped);
  // Every clue list is unique, so a clue never points at someone else's cache.
  // Two photos of the same landmark read the same, so the pose is part of the key.
  expect(new Set(caches.map((c) => c.clues.join("\n") + (c.photo ? `|${c.photo.x},${c.photo.z}` : ""))).size).toBe(n);
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
    // Any clue area around a piece holds the whole piece: never the hardest.
    // A shadow tip isn't at its piece.
    if (pieceIds.has(c.source) && c.shadowMin === undefined) expect(c.difficulty).toBeLessThanOrEqual(2);
  }
  expect(keys.size).toBe(caches.length);
}

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
        expect(makeCaches(l, rng(l.seed ^ 0xcac4e), SKY)).toBeNull();
        expect(h.layout.seed).toBeGreaterThan(l.seed);
      }
    }
    expect(same).toBeGreaterThan(190);
  }, 60_000);

  it("returns null when there are fewer than 20 valid spots", () => {
    const l = generateLayout(1);
    expect(makeCaches({ ...l, pieces: [], minor: l.minor.slice(0, 5) }, rng(1), SKY)).toBeNull();
  });

  it("1000 seeds: never throws, 20–30 valid caches per map, about half from pieces", () => {
    for (let seed = 1; seed <= 1000; seed++) checkHunt(seed, SKY);
  }, 120_000);

  it("100 seeds at night, 15 minutes: never throws, same rules", () => {
    for (let seed = 1; seed <= 100; seed++) checkHunt(seed, { startMin: START_MIN.night, minutes: 15 });
  }, 60_000);
});

describe("light clues", () => {
  const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
  const NIGHT: HuntSky = { startMin: START_MIN.night, minutes: 30 };

  it("50 seeds at night: at least 40 maps have a lamp clue", () => {
    const hits = SEEDS.filter((s) => makeHunt(s, NIGHT).caches.some((c) => c.clues.some((t) => LAMP.test(t))));
    expect(hits.length).toBeGreaterThanOrEqual(40);
  });

  it("50 seeds by day: at least 40 maps have a shadow clue", () => {
    const hits = SEEDS.filter((s) => makeHunt(s, SKY).caches.some((c) => c.clues.some((t) => SHADOW.test(t))));
    expect(hits.length).toBeGreaterThanOrEqual(40);
  });

  it("a map with any light spot leads at least 1 cache with a light clue", () => {
    for (const sky of [SKY, NIGHT]) {
      for (const s of SEEDS) {
        const { layout: l, caches } = makeHunt(s, sky);
        const any = cacheSpots(l, sky).some((p) => clueKinds(l, p, sky).some((k) => k === "shadow" || k === "lamp"));
        if (!any) continue;
        expect(caches.filter((c) => isLight(c.clues[0]!)).length, `seed ${s}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("photo quota", () => {
  const PHOTO = /^A photo taken about 5 m from the cache/;

  it("50 seeds, day and night: up to PHOTO_TARGET caches lead with a photo, and light still leads", () => {
    for (const sky of [SKY, { startMin: START_MIN.night, minutes: 30 }]) {
      for (let s = 1; s <= 50; s++) {
        const { layout: l, caches } = makeHunt(s, sky);
        const spots = cacheSpots(l, sky);
        // A light-forced spot isn't forced for a photo too, so count the others.
        const photoable = spots.filter((p) => {
          const k = clueKinds(l, p, sky);
          return k.includes("photo") && !k.includes("shadow") && !k.includes("lamp");
        }).length;
        const lightable = spots.some((p) => clueKinds(l, p, sky).some((k) => k === "shadow" || k === "lamp"));
        const lead = caches.filter((c) => PHOTO.test(c.clues[0]!)).length;
        // A photo's key holds its pose, so a forced photo spot is never dropped as a repeat.
        expect(lead, `seed ${s}`).toBeGreaterThanOrEqual(Math.min(PHOTO_TARGET, photoable));
        if (lightable) expect(caches.some((c) => isLight(c.clues[0]!)), `seed ${s}`).toBe(true);
      }
    }
  }, 60_000);
});
