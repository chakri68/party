import { describe, expect, it } from "vitest";
import { lightAt, runMsOf, skyPlan, skyWords, type Light, type TimeSetting } from "../shared/sky.ts";
import cases from "../godot/tests/sky_cases.json";

const T = { length: 2259, par_seconds: null };

describe("lightAt", () => {
  it.each(cases.cases.map((c) => [c.ms, c] as const))("matches the shared table at %i ms", (_ms, c) => {
    expect(lightAt(c.plan as never, c.ms).k).toBeCloseTo(c.k, 6);
  });
});

describe("runMsOf", () => {
  it("falls back to 50 ms a metre, and prefers par", () => {
    expect(runMsOf(T)).toBe(112950);
    expect(runMsOf({ length: 2259, par_seconds: 90 })).toBe(90000);
  });
});

describe("skyPlan", () => {
  it.each(["day", "dawn", "dusk", "night"] as const)("%s is static", (t) => {
    expect(skyPlan(t, 7, T)).toEqual({ light: { from: t, to: t, atMs: 0, overMs: 0 } });
  });

  it("sunset runs day into night over the middle half", () => {
    expect(skyPlan("sunset", 1, { length: 2000, par_seconds: null })).toEqual({ light: { from: "day", to: "night", atMs: 25000, overMs: 50000 } });
  });

  it("random is stable per seed and covers all five options", () => {
    const lights: Light[] = ["day", "dawn", "dusk", "night"];
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const p = skyPlan("random", s, T);
      expect(skyPlan("random", s, T)).toEqual(p);
      expect(lights).toContain(p.light.from);
      expect(lights).toContain(p.light.to);
      seen.add(p.light.from !== p.light.to ? "sunset" : p.light.from);
    }
    expect([...seen].sort()).toEqual(["dawn", "day", "dusk", "night", "sunset"]);
  });
});

describe("skyWords", () => {
  it("names each plan", () => {
    const w = (t: TimeSetting) => skyWords(skyPlan(t, 0, T));
    expect([w("day"), w("dawn"), w("dusk"), w("night"), w("sunset")]).toEqual([
      "Day.", "Dawn.", "Dusk.", "Night.", "Day into night. The sun goes down while you drive.",
    ]);
  });
});
