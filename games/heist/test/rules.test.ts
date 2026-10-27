import { describe, expect, it } from "vitest";
import {
  crewSize,
  crewSizes,
  DEFAULT_SETTINGS,
  heistSettingFields,
  JOB_NAMES,
  JOBS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  moleRange,
  molesFor,
  parseHeistSettings,
  setupProblem,
  usualMoles,
} from "../shared/index.ts";

const ALL_N = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

describe("crew sizes", () => {
  it("every table gets five valid jobs: growing, the first at most ⌈N/3⌉, none over N−1", () => {
    for (const n of ALL_N) {
      const sizes = crewSizes(n);
      expect(sizes, `N=${n}`).toHaveLength(JOBS);
      expect(sizes[0]!, `N=${n} first`).toBeLessThanOrEqual(Math.ceil(n / 3));
      for (let k = 1; k < JOBS; k++) expect(sizes[k]!, `N=${n} job ${k}`).toBeGreaterThanOrEqual(sizes[k - 1]!);
      expect(sizes[JOBS - 1]!, `N=${n} last`).toBeGreaterThan(sizes[0]!);
      for (const s of sizes) {
        expect(s, `N=${n}`).toBeLessThanOrEqual(n - 1);
        expect(s, `N=${n}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("matches the design doc's table", () => {
    expect(Object.fromEntries(ALL_N.map((n) => [n, crewSizes(n).join(" ")]))).toEqual({
      5: "2 2 3 3 3",
      6: "2 2 3 3 3",
      7: "3 3 4 4 4",
      8: "3 3 4 4 4",
      9: "3 4 4 5 5",
      10: "4 4 5 5 5",
    });
  });

  it("is a formula, not a table: ends at ⌈N/2⌉", () => {
    for (const n of ALL_N) expect(crewSize(n, JOBS - 1)).toBe(Math.ceil(n / 2));
  });
});

describe("moles", () => {
  it("2 for 5–6, 3 for 7–8, 4 for 9–10", () => {
    expect(ALL_N.map(usualMoles)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it("the usual count is always in range, and always fewer moles than crew", () => {
    for (const n of ALL_N) {
      const [lo, hi] = moleRange(n);
      expect(usualMoles(n)).toBeGreaterThanOrEqual(lo);
      expect(usualMoles(n)).toBeLessThanOrEqual(hi);
      expect(hi * 2).toBeLessThan(n);
    }
  });

  it("one fewer fits from 7; one more never does", () => {
    for (const n of ALL_N) {
      const fewer = setupProblem({ ...DEFAULT_SETTINGS, moles: "fewer" }, n);
      if (n >= 7) expect(fewer, `N=${n}`).toBeNull();
      else expect(fewer).toBe(`${n} players need at least 2 moles`);
      expect(setupProblem({ ...DEFAULT_SETTINGS, moles: "more" }, n)).toBe(`${n} players can have at most ${moleRange(n)[1]} moles`);
      expect(setupProblem(DEFAULT_SETTINGS, n)).toBeNull();
    }
    expect(molesFor({ ...DEFAULT_SETTINGS, moles: "fewer" }, 9)).toBe(3);
  });

  it("says nothing while the table's still filling", () => {
    expect(setupProblem({ ...DEFAULT_SETTINGS, moles: "fewer" }, 3)).toBeNull();
  });
});

describe("settings", () => {
  it("parses partial, refuses junk", () => {
    expect(parseHeistSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseHeistSettings({ preset: "fast" })).toEqual({ preset: "fast", moles: "usual" });
    expect(parseHeistSettings({ moles: "more" })).toEqual({ preset: "beginner", moles: "more" });
    expect(parseHeistSettings({ preset: "chaos" })).toBeNull();
    expect(parseHeistSettings({ moles: 3 })).toBeNull();
    expect(parseHeistSettings([])).toBeNull();
  });

  it("the lobby rows: pace with its timers, moles with the count and crews", () => {
    const [pace, moles] = heistSettingFields(DEFAULT_SETTINGS, 7);
    expect(pace!.options.map((o) => o.label)).toEqual(["Beginner", "Standard", "Fast"]);
    expect(pace!.hint).toBe("Leader 60 s, vote 30 s, card 20 s");
    expect(moles!.options.map((o) => o.label)).toEqual(["Usual (3)", "One fewer (2)"]);
    expect(moles!.hint).toBe("3 of 7, 2–3 allowed. Crews: 3, 3, 4, 4, 4");
    expect(heistSettingFields({ moles: "fewer" }, 5)[1]!.hint).toBe("5 players need at least 2 moles");
    expect(heistSettingFields({ preset: "fast" }, 5)[0]!.hint).toBe("Leader 30 s, vote 15 s, card 10 s");
  });

  it("five jobs, five names", () => {
    expect(JOB_NAMES).toHaveLength(JOBS);
  });
});
