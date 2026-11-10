import { describe, expect, it } from "vitest";
import { TIMES, TIME_LABELS, clockText, darkAt, darkWithin, shadowTip, startMinOf, sunAt, timeHint } from "../shared/sky.ts";
import cases from "../godot/tests/day_cases.json";

describe("sunAt", () => {
  it("is due south and high at noon", () => {
    const s = sunAt(720);
    expect(s.az).toBeCloseTo(180, 6);
    expect(s.el).toBeCloseTo(55, 6);
  });
  it("rises in the east and sets in the west", () => {
    expect(sunAt(360).el).toBeCloseTo(0, 6);
    expect(sunAt(360).az).toBeCloseTo(90, 6);
    expect(sunAt(1080).az).toBeCloseTo(270, 6);
  });
  it("wraps past 24:00", () => {
    expect(sunAt(720 + 1440).el).toBeCloseTo(55, 6);
  });
});

describe("darkAt", () => {
  it("is 0 at noon and 1 at midnight", () => {
    expect(darkAt(720)).toBe(0);
    expect(darkAt(0)).toBe(1);
  });
  it("only grows through dusk", () => {
    let prev = darkAt(1060);
    for (let m = 1061; m <= 1140; m++) {
      const d = darkAt(m);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe("clockText", () => {
  it("formats HH:MM, wraps and floors", () => {
    expect(clockText(1060)).toBe("17:40");
    expect(clockText(1445)).toBe("00:05");
    expect(clockText(600.9)).toBe("10:00");
  });
});

describe("startMinOf", () => {
  it("maps fixed settings", () => {
    expect(startMinOf("day", 1)).toBe(600);
    expect(startMinOf("dusk", 7)).toBe(1060);
    expect(startMinOf("night", 7)).toBe(1320);
  });
  it("random picks day, dusk or night about evenly", () => {
    const n = new Map<number, number>();
    for (let s = 0; s < 300; s++) {
      const m = startMinOf("random", s);
      expect([600, 1060, 1320]).toContain(m);
      n.set(m, (n.get(m) ?? 0) + 1);
    }
    for (const m of [600, 1060, 1320]) expect(n.get(m) ?? 0).toBeGreaterThanOrEqual(60);
  });
});

describe("shadowTip", () => {
  it("lies opposite the sun at top / tan(el)", () => {
    const t = shadowTip({ x: 0, z: 0 }, 20, 720)!;
    expect(t.x).toBeCloseTo(0, 1);
    expect(t.z).toBeCloseTo(-14.0, 1);
  });
  it("is null with the sun low", () => {
    expect(shadowTip({ x: 0, z: 0 }, 20, 1060)).toBeNull();
  });
  it("is null when the shadow is too long", () => {
    expect(shadowTip({ x: 0, z: 0 }, 2000, 720)).toBeNull();
  });
});

describe("darkWithin", () => {
  it("looks along the window", () => {
    expect(darkWithin(1060, 15)).toBe(false);
    expect(darkWithin(1060, 60)).toBe(true);
    expect(darkWithin(600, 60)).toBe(false);
    expect(darkWithin(1320, 15)).toBe(true);
  });
});

describe("labels", () => {
  it("has a label and hint for every setting", () => {
    for (const t of TIMES) {
      expect(TIME_LABELS[t].length).toBeGreaterThan(0);
      expect(timeHint(t).length).toBeGreaterThan(0);
    }
  });
});

describe("day_cases.json", () => {
  it("covers the key minutes", () => {
    for (const m of [0, 360, 600, 720, 1060, 1080, 1100, 1320]) expect(cases.cases.map((c) => c.min)).toContain(m);
    expect(cases.cases.length).toBeGreaterThanOrEqual(12);
  });
  it.each(cases.cases.map((c) => [c.min, c] as const))("matches the shared table at %i", (_m, c) => {
    const s = sunAt(c.min);
    expect(s.az).toBeCloseTo(c.az, 3);
    expect(s.el).toBeCloseTo(c.el, 3);
    expect(darkAt(c.min)).toBeCloseTo(c.dark, 3);
  });
});
