import { describe, expect, it } from "vitest";
import { ROLE_ATTRS, WAY_BONUS, chance36, failCost, percent, rollDice } from "../shared/roll.ts";
import { RUINS } from "../shared/ruins.ts";

describe("rolls", () => {
  it("counts exact chances", () => {
    expect(chance36(1, 7)).toBe(26);
    expect(chance36(1, 9)).toBe(15);
    expect(chance36(2, 9)).toBe(21);
    expect(chance36(4, 9)).toBe(30);
    expect(chance36(-1, 9)).toBe(6);
    expect(chance36(5, 7)).toBe(36);
    expect(percent(1, 9)).toBe(42);
    expect(percent(1, 7)).toBe(72);
    expect(percent(4, 9)).toBe(83);
  });
  it("agrees with a brute count", () => {
    for (let bonus = -1; bonus <= 4; bonus++) {
      for (const need of [7, 9] as const) {
        let n = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b + bonus >= need) n++;
        expect(chance36(bonus, need)).toBe(n);
      }
    }
  });
  it("applies Careful to fail costs", () => {
    expect(failCost(RUINS.shrine.approaches[1], "careful")).toEqual({ damage: 0, noise: 1 });
    expect(failCost(RUINS.tower.approaches[1], "careful")).toEqual({ damage: 0, noise: 1 });
    expect(failCost(RUINS.tower.approaches[1], "bold")).toEqual({ damage: 0, noise: 3 });
    expect(failCost(RUINS.shrine.approaches[1], "normal")).toEqual({ damage: 1, noise: 0 });
  });
  it("has role attributes and way bonuses", () => {
    expect(ROLE_ATTRS.runner).toEqual({ strength: 0, mind: 1, stealth: 2 });
    expect(ROLE_ATTRS.fixer).toEqual({ strength: 1, mind: 2, stealth: 0 });
    expect(ROLE_ATTRS.protector).toEqual({ strength: 2, mind: 0, stealth: 1 });
    expect(ROLE_ATTRS.guide).toEqual({ strength: 0, mind: 2, stealth: 1 });
    expect(WAY_BONUS).toEqual({ careful: -1, normal: 0, bold: 1 });
  });
  it("rolls two dice in order", () => {
    const seq = [2, 5];
    expect(rollDice(() => seq.shift()!)).toEqual([3, 6]);
  });
  it("has the ruin table", () => {
    expect(RUINS.shrine.name).toBe("Sunken Shrine");
    expect(RUINS.tower.name).toBe("Star Tower");
    expect(RUINS.cave.name).toBe("Root Cave");
    expect(RUINS.shrine.approaches[0]).toEqual({ label: "Read the old words", attr: "mind", need: 9, fail: { damage: 0, noise: 2 } });
    expect(RUINS.tower.approaches[0]).toMatchObject({ label: "Climb in quietly", attr: "stealth", need: 9, fail: { damage: 1, noise: 0 } });
    expect(RUINS.cave.approaches[1]).toMatchObject({ label: "Pull the roots away", attr: "strength", need: 9, fail: { damage: 1, noise: 0 } });
  });
});
