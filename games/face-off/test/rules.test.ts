import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../shared/categories.ts";
import { faceOffSettingFields } from "../shared/rules-text.ts";
import { categoryId } from "../shared/types.ts";

describe("the deck", () => {
  it("has 150+ categories, none twice, no id twice", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
    expect(new Set(CATEGORIES.map(categoryId)).size).toBe(CATEGORIES.length);
  });

  it("keeps every category lowercase, tidy and short enough for a phone", () => {
    for (const c of CATEGORIES) {
      expect(c).toBe(c.trim().toLowerCase());
      expect(c).toMatch(/^[a-z][a-z' ]*[a-z]$/);
      expect(c).not.toMatch(/ {2}/);
      expect(c.length, c).toBeLessThanOrEqual(32);
      expect(categoryId(c)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("settings fields", () => {
  it("offer 10, 15 and 20 points, with the current pick selected", () => {
    const [target] = faceOffSettingFields({ target: 15 });
    expect(target!.options.map((o) => o.label)).toEqual(["10 points", "15 points", "20 points"]);
    expect(target!.selected).toBe(1);
    expect(faceOffSettingFields(null)[0]!.selected).toBe(0);
  });
});
