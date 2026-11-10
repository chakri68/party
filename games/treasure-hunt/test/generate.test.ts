import { describe, expect, it } from "vitest";
import {
  BIOMES,
  MACRO_CELL,
  MACRO_ORIGIN,
  MACRO_SIZE,
  PLAY_HALF,
  generateLayout,
  macroHeight,
  makeLayout,
  validateLayout,
  type TreasureLayout,
} from "../shared/index.ts";

const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);

// One pass over 1000 seeds, shared by the tests that need it.
let cache: TreasureLayout[] | undefined;
const layouts = (): TreasureLayout[] => (cache ??= SEEDS.map((s) => makeLayout(s)));

/** A point `out` metres outside side `side` (N, E, S, W), at `t` along it. */
function sidePoint(side: number, t: number, out: number): [number, number] {
  const e = PLAY_HALF + out;
  switch (side) {
    case 0: return [t, -e];
    case 1: return [e, t];
    case 2: return [t, e];
    default: return [-e, t];
  }
}

describe("generateLayout", () => {
  it("is a pure function of the seed", () => {
    expect(generateLayout(7)).toEqual(generateLayout(7));
    expect(generateLayout(8)).not.toEqual(generateLayout(7));
  });

  it("has the right shape", () => {
    const l = generateLayout(7);
    expect(l.version).toBe(1);
    expect(l.macro).toMatchObject({ origin: MACRO_ORIGIN, cell: MACRO_CELL, size: MACRO_SIZE });
    expect(l.macro.heights).toHaveLength(61 * 61);
    expect(l.macro.biomes).toHaveLength(61 * 61);
    expect(l.macro.heights.every((h) => Number.isInteger(h))).toBe(true);
    expect(l.macro.biomes.every((b) => Number.isInteger(b) && b >= 0 && b < BIOMES.length)).toBe(true);
    expect(l.ring).toHaveLength(4);
  });
});

describe("macroHeight", () => {
  const l = generateLayout(11);
  const vx = (i: number) => MACRO_ORIGIN + i * MACRO_CELL;
  const h = (i: number, j: number) => l.macro.heights[j * MACRO_SIZE + i]!;

  it("equals the vertex height at a vertex", () => {
    for (const [i, j] of [[0, 0], [30, 30], [12, 47], [60, 60]] as const) {
      expect(macroHeight(l, vx(i), vx(j))).toBe(h(i, j) / 10);
    }
  });

  it("is the mean midway between two vertices", () => {
    expect(macroHeight(l, vx(20) + 16, vx(33))).toBeCloseTo((h(20, 33) + h(21, 33)) / 20, 9);
    expect(macroHeight(l, vx(5), vx(40) + 16)).toBeCloseTo((h(5, 40) + h(5, 41)) / 20, 9);
  });
});

describe("1000 seeds", () => {
  it("are all valid, with fewer than 2% rerolls", () => {
    const all = layouts();
    const invalid = all.filter((l) => validateLayout(l).length > 0);
    expect(invalid.map((l) => [l.seed, validateLayout(l)])).toEqual([]);
    const rerolls = all.filter((l, i) => l.seed !== SEEDS[i]).length;
    expect(rerolls).toBeLessThan(20);
  }, 20_000); // the first test to touch layouts() pays for all 1000

  it("spawn on land, inside the margin, facing the centre", () => {
    for (const l of layouts()) {
      const { x, z, yaw } = l.spawn;
      expect(macroHeight(l, x, z)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(x)).toBeLessThanOrEqual(650);
      expect(Math.abs(z)).toBeLessThanOrEqual(650);
      // Godot faces −Z at yaw 0, so the forward vector is (−sin, −cos).
      const want = Math.atan2(-x, -z);
      const have = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
      const diff = Math.abs(Math.atan2(Math.sin(want - have), Math.cos(want - have)));
      expect(diff).toBeLessThan(0.01);
    }
  });
});

describe("the edge ring", () => {
  it("drops to the sea on a sea side", () => {
    const l = layouts().find((l) => l.ring.includes("sea"))!;
    expect(l).toBeDefined();
    const side = l.ring.indexOf("sea");
    // Away from the corners, where a neighbouring side can take over.
    for (let t = -550; t <= 550; t += 25) {
      expect(macroHeight(l, ...sidePoint(side, t, 64))).toBeLessThanOrEqual(-3);
      // Below 2 m at the edge and at least 2 m 150 m in: the shore lies between.
      expect(macroHeight(l, ...sidePoint(side, t, 0))).toBeLessThan(2);
      expect(macroHeight(l, ...sidePoint(side, t, -150))).toBeGreaterThanOrEqual(2);
    }
  });

  it("climbs at least 81 m in 96 m on every side of an all-mountain map", () => {
    const l = layouts().find((l) => l.ring.every((r) => r === "mountain"))!;
    expect(l).toBeDefined();
    for (let side = 0; side < 4; side++) {
      for (let t = -PLAY_HALF; t <= PLAY_HALF; t += 25) {
        const rise = macroHeight(l, ...sidePoint(side, t, 96)) - macroHeight(l, ...sidePoint(side, t, 0));
        expect(rise).toBeGreaterThanOrEqual(81);
      }
    }
  });

  it("never has more than two sea sides", () => {
    for (const l of layouts()) expect(l.ring.filter((r) => r === "sea").length).toBeLessThanOrEqual(2);
  });
});

describe("validateLayout", () => {
  it("catches a flat ring and a drowned spawn", () => {
    const l = structuredClone(generateLayout(7));
    l.macro.heights.fill(50);
    expect(validateLayout(l).some((p) => /side/.test(p))).toBe(true);

    const m = structuredClone(generateLayout(7));
    m.macro.heights = m.macro.heights.map(() => -20);
    expect(validateLayout(m).some((p) => /spawn/.test(p))).toBe(true);
    expect(validateLayout(m).some((p) => /land/.test(p))).toBe(true);
  });
});
