import { describe, expect, it } from "vitest";
import { deckOf, MAX_PLAYERS, MIN_PLAYERS, PRESETS, setupProblem, wolvesFor } from "../shared/roles.ts";
import { nightfallRules, nightfallSettingFields, parseNightfallSettings } from "../shared/rules-text.ts";
import { DEFAULT_SETTINGS, type NightfallSettings } from "../shared/types.ts";

const custom = (counts: Record<string, number>): NightfallSettings => ({
  ...DEFAULT_SETTINGS,
  preset: "custom",
  ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [`n:${k}`, v])),
});

describe("decks", () => {
  it("scales the Wolves: 1 at 5–6, 2 at 7–9, 3 at 10–12", () => {
    expect([5, 6, 7, 8, 9, 10, 11, 12].map(wolvesFor)).toEqual([1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it("every preset deals every table it seats", () => {
    for (const p of PRESETS) {
      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) expect(setupProblem({ ...DEFAULT_SETTINGS, preset: p.id }, n), `${p.id} at ${n}`).toBeNull();
    }
  });

  it("Beginner is Wolves and Villagers; Standard adds the Watcher; Full the Keeper too", () => {
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "beginner" }, 7)).toEqual({ wolf: 2, villager: 5 });
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "standard" }, 7)).toEqual({ wolf: 2, watcher: 1, villager: 4 });
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "full" }, 12)).toEqual({ wolf: 3, watcher: 1, keeper: 1, villager: 7 });
  });

  it("checks a custom deck: size, a wolf, uniques, two non-wolves, wolves outnumbered", () => {
    expect(setupProblem(custom({ wolf: 1, villager: 3 }), 5)).toBe("Need exactly 5 role cards (have 4)");
    expect(setupProblem(custom({ villager: 5 }), 5)).toBe("Needs at least one Wolf team card");
    expect(setupProblem(custom({ wolf: 1, watcher: 2, villager: 2 }), 5)).toBe("Watcher is unique");
    expect(setupProblem(custom({ wolf: 3, villager: 2 }), 5)).toBe("Wolves must be fewer than everyone else");
    expect(setupProblem(custom({ wolf: 2, villager: 3 }), 5)).toBeNull();
    expect(setupProblem(custom({ wolf: 1, watcher: 1, keeper: 1, villager: 2 }), 5)).toBeNull();
  });
});

describe("settings", () => {
  it("defaults, and refuses what isn't on offer", () => {
    expect(parseNightfallSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseNightfallSettings({ discussMinutes: 5, nightSeconds: 45 })).toMatchObject({ discussMinutes: 5, nightSeconds: 45 });
    expect(parseNightfallSettings({ discussMinutes: 9 })).toBeNull();
    expect(parseNightfallSettings({ nightSeconds: 31 })).toBeNull();
    expect(parseNightfallSettings({ preset: "chaos" })).toBeNull();
    expect(parseNightfallSettings([])).toBeNull();
  });

  it("lobby rows: roles, then talking time and night", () => {
    const rows = nightfallSettingFields(DEFAULT_SETTINGS, 7);
    expect(rows.map((r) => r.key)).toEqual(["preset", "discussMinutes", "nightSeconds"]);
    expect(rows[0]!.hint).toBe("2 Wolf, 1 Watcher, 4 Villager");
    expect(rows[1]!.options.map((o) => o.label)).toEqual(["1 min", "2 min", "3 min", "4 min", "5 min"]);
    expect(rows[1]!.selected).toBe(1);
    const customRows = nightfallSettingFields(custom({ wolf: 1, villager: 4 }), 5);
    expect(customRows.map((r) => r.key)).toEqual(["preset", "n:wolf", "n:watcher", "n:keeper", "n:villager", "discussMinutes", "nightSeconds"]);
  });

  it("rules name every card", () => {
    const text = nightfallRules.join(" ");
    for (const name of ["Wolf", "Watcher", "Keeper", "Villager"]) expect(text).toContain(name);
  });
});
