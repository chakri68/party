import { describe, expect, it } from "vitest";
import { buggySlots } from "../shared/buggies.ts";
import { generateLayout, macroHeight } from "../shared/generate.ts";
import { LOOSE_BUGGIES } from "../shared/world.ts";

describe("buggySlots", () => {
  it("slots are deterministic, on land, and team slots are ≥ 4 m apart", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const l = generateLayout(seed);
      const slots = buggySlots(l);
      expect(buggySlots(l)).toEqual(slots);
      const team = slots.filter((s) => s.id.startsWith("t"));
      const loose = slots.filter((s) => s.id.startsWith("l"));
      expect(team.map((s) => s.id)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
      expect(loose.length).toBeLessThanOrEqual(LOOSE_BUGGIES);
      expect(loose.map((s) => s.id)).toEqual(loose.map((_, i) => `l${i}`));
      for (const s of slots) {
        expect(macroHeight(l, s.x, s.z), `seed ${seed} ${s.id}`).toBeGreaterThan(0.5);
        expect(Number.isFinite(s.yaw)).toBe(true);
      }
      for (const s of team) {
        expect(Math.hypot(s.x - l.spawn.x, s.z - l.spawn.z), `seed ${seed} ${s.id}`).toBeLessThanOrEqual(12.01);
        expect(s.yaw).toBeCloseTo(l.spawn.yaw, 2);
      }
      for (let i = 0; i < team.length; i++)
        for (let j = i + 1; j < team.length; j++)
          expect(Math.hypot(team[i]!.x - team[j]!.x, team[i]!.z - team[j]!.z), `seed ${seed}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("loose buggies sit padR + 5 from a piece, facing the spawn", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const l = generateLayout(seed);
      const loose = buggySlots(l).filter((s) => s.id.startsWith("l"));
      if (l.pieces.length >= LOOSE_BUGGIES + 3) expect(loose).toHaveLength(LOOSE_BUGGIES);
      for (const s of loose) {
        const p = l.pieces.find((q) => Math.abs(Math.hypot(s.x - q.x, s.z - q.z) - (q.padR + 5)) < 0.05);
        expect(p, `seed ${seed} ${s.id}`).toBeDefined();
        // Forward at yaw θ is (−sin θ, −cos θ): it points at the spawn.
        const d = Math.hypot(l.spawn.x - s.x, l.spawn.z - s.z);
        expect(-Math.sin(s.yaw)).toBeCloseTo((l.spawn.x - s.x) / d, 2);
        expect(-Math.cos(s.yaw)).toBeCloseTo((l.spawn.z - s.z) / d, 2);
      }
    }
  });
});
