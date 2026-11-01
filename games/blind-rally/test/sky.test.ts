import { describe, expect, it } from "vitest";
import { RAINS, lightAt, rainAt, rainHint, runMsOf, skyPlan, skyWords, wetnessAt, type Light, type RainSetting, type TimeSetting } from "../shared/sky.ts";
import cases from "../godot/tests/sky_cases.json";

const T = { length: 2259, par_seconds: null };

describe("lightAt", () => {
  it.each(cases.cases.map((c) => [c.ms, c] as const))("matches the shared table at %i ms", (_ms, c) => {
    expect(lightAt(c.plan as never, c.ms).k).toBeCloseTo(c.k, 6);
  });
});

describe("rainAt and wetnessAt", () => {
  it.each(cases.cases.filter((c) => "rain" in c).map((c) => [c.ms, c] as const))("match the shared table at %i ms", (_ms, c) => {
    expect(rainAt(c.plan as never, c.ms)).toBeCloseTo((c as { rain: number }).rain, 4);
    expect(wetnessAt(c.plan as never, c.ms)).toBeCloseTo((c as { wet: number }).wet, 4);
  });
});

describe("rainHint", () => {
  it("has a hint for every setting", () => {
    for (const r of RAINS) expect(rainHint(r).length).toBeGreaterThan(0);
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
    expect(skyPlan(t, "dry", 7, T)).toEqual({ light: { from: t, to: t, atMs: 0, overMs: 0 }, rain: { from: 0, to: 0, atMs: 0, overMs: 0 } });
  });

  it("sunset runs day into night over the middle half", () => {
    expect(skyPlan("sunset", "dry", 1, { length: 2000, par_seconds: null })).toEqual({ light: { from: "day", to: "night", atMs: 25000, overMs: 50000 }, rain: { from: 0, to: 0, atMs: 0, overMs: 0 } });
  });

  it("random is stable per seed and covers all five options", () => {
    const lights: Light[] = ["day", "dawn", "dusk", "night"];
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const p = skyPlan("random", "dry", s, T);
      expect(skyPlan("random", "dry", s, T)).toEqual(p);
      expect(lights).toContain(p.light.from);
      expect(lights).toContain(p.light.to);
      seen.add(p.light.from !== p.light.to ? "sunset" : p.light.from);
    }
    expect([...seen].sort()).toEqual(["dawn", "day", "dusk", "night", "sunset"]);
  });
});

describe("skyWords", () => {
  it("names each plan", () => {
    const w = (t: TimeSetting) => skyWords(skyPlan(t, "dry", 0, T), "x");
    expect([w("day"), w("dawn"), w("dusk"), w("night"), w("sunset")]).toEqual([
      "Day.", "Dawn.", "Dusk.", "Night.", "Day into night. The sun goes down while you drive.",
    ]);
  });
});

describe("rain plans", () => {
  const L = { length: 2000, par_seconds: null };
  it("rain and dry are static", () => {
    expect(skyPlan("day", "rain", 3, L).rain).toEqual({ from: 1, to: 1, atMs: 0, overMs: 0 });
    expect(skyPlan("day", "dry", 3, L).rain).toEqual({ from: 0, to: 0, atMs: 0, overMs: 0 });
  });

  it.each([["storm", 0, 1, 30000], ["clears", 1, 0, 20000]] as const)("%s ramps at 30-50%% of the run", (r, from, to, over) => {
    for (let s = 0; s < 50; s++) {
      const p = skyPlan("day", r, s, L).rain;
      expect(p.from).toBe(from);
      expect(p.to).toBe(to);
      expect(p.overMs).toBe(over);
      expect(p.atMs).toBeGreaterThanOrEqual(30000);
      expect(p.atMs).toBeLessThanOrEqual(50000);
      expect(skyPlan("day", r, s, L).rain).toEqual(p);
    }
  });

  it("random covers all four, near 40/20/20/20", () => {
    const n: Record<string, number> = { dry: 0, rain: 0, storm: 0, clears: 0 };
    for (let s = 0; s < 400; s++) {
      const p = skyPlan("day", "random", s, L).rain;
      n[p.from === p.to ? (p.to ? "rain" : "dry") : p.to ? "storm" : "clears"]!++;
    }
    expect(n.dry! / 400).toBeGreaterThanOrEqual(0.25);
    expect(n.dry! / 400).toBeLessThanOrEqual(0.55);
    for (const k of ["rain", "storm", "clears"]) {
      expect(n[k]! / 400).toBeGreaterThanOrEqual(0.1);
      expect(n[k]! / 400).toBeLessThanOrEqual(0.3);
    }
  });

  it("words", () => {
    const w = (t: TimeSetting, r: RainSetting, id = "x") => skyWords(skyPlan(t, r, 0, L), id);
    expect(w("day", "dry")).toBe("Day.");
    expect(w("night", "rain")).toBe("Night. Rain.");
    expect(w("day", "storm")).toBe("Day. Rain starts during the run.");
    expect(w("day", "clears", "snowblind")).toBe("Day. Snow stops during the run.");
  });
});
