import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  deckOf,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NIGHT_ORDER,
  nightSteps,
  parseShortNightSettings,
  PRESETS,
  readsAsWolf,
  ROLES,
  setupProblem,
  shortNightSettingFields,
  type ShortNightSettings,
} from "../shared/index.ts";

const custom = (counts: Record<string, number>): ShortNightSettings => ({
  ...DEFAULT_SETTINGS,
  preset: "custom",
  ...Object.fromEntries(ROLES.map((r) => [`n:${r.id}`, counts[r.id] ?? 0])),
});

describe("roles", () => {
  it("Wolf and Villager plus six of our own, wolves on their own team", () => {
    expect(ROLES.map((r) => r.id).sort()).toEqual(["bellringer", "gossip", "lamplighter", "matchmaker", "stray", "villager", "wanderer", "wolf"]);
    expect(ROLES.filter((r) => r.team === "wolves").map((r) => r.id)).toEqual(["wolf"]);
  });

  it("acts in a fixed published order, Wolves first", () => {
    expect(NIGHT_ORDER).toEqual(["wolf", "lamplighter", "matchmaker", "bellringer", "gossip", "wanderer"]);
  });

  it("only the Wolf and the Stray read as wolves", () => {
    expect(ROLES.filter((r) => readsAsWolf(r.id)).map((r) => r.id)).toEqual(["wolf", "stray"]);
  });
});

describe("presets", () => {
  it("every preset deals every table from 4 to 10", () => {
    for (const p of PRESETS) {
      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
        expect(setupProblem({ ...DEFAULT_SETTINGS, preset: p.id }, n), `${p.id} at ${n}`).toBeNull();
      }
    }
  });

  it("one wolf at 4–5, two from 6", () => {
    for (const p of PRESETS) {
      expect(deckOf({ ...DEFAULT_SETTINGS, preset: p.id }, 5).wolf).toBe(1);
      expect(deckOf({ ...DEFAULT_SETTINGS, preset: p.id }, 6).wolf).toBe(2);
      expect(deckOf({ ...DEFAULT_SETTINGS, preset: p.id }, 10).wolf).toBe(2);
    }
  });

  it("Beginner is wolves, a Lamplighter and Villagers", () => {
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "beginner" }, 7)).toEqual({ wolf: 2, lamplighter: 1, villager: 4 });
  });

  it("Standard adds the Matchmaker and the Gossip", () => {
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "standard" }, 4)).toEqual({ wolf: 1, lamplighter: 1, matchmaker: 1, gossip: 1 });
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "standard" }, 8)).toEqual({ wolf: 2, lamplighter: 1, matchmaker: 1, gossip: 1, villager: 3 });
  });

  it("Full fits as many roles as there are seats, Stray last", () => {
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "full" }, 4)).toEqual({ wolf: 1, lamplighter: 1, matchmaker: 1, gossip: 1 });
    expect(deckOf({ ...DEFAULT_SETTINGS, preset: "full" }, 10)).toEqual({
      wolf: 2, lamplighter: 1, matchmaker: 1, gossip: 1, bellringer: 1, wanderer: 1, stray: 1, villager: 2,
    });
  });
});

describe("setupProblem", () => {
  it("wants exactly one card per player", () => {
    expect(setupProblem(custom({ wolf: 1, lamplighter: 1, villager: 3 }), 6)).toBe("Need exactly 6 role cards (have 5)");
  });

  it("wants a wolf", () => {
    expect(setupProblem(custom({ lamplighter: 1, villager: 4 }), 5)).toBe("Needs at least one Wolf card");
  });

  it("wants a village card, and says so in those words", () => {
    // Two non-wolves would also be short; the team check comes first.
    expect(setupProblem(custom({ wolf: 3 }), 3)).toBe("Needs at least one Village card");
  });

  it("wants two non-wolves", () => {
    expect(setupProblem(custom({ wolf: 3, villager: 1 }), 4)).toBe("Needs at least two non-wolf cards");
    expect(setupProblem(custom({ wolf: 3, villager: 2 }), 5)).toBeNull();
  });

  it("caps the unique roles", () => {
    expect(setupProblem(custom({ wolf: 1, lamplighter: 2, villager: 2 }), 5)).toBe("Lamplighter is unique");
  });

  it("a custom deck that fit stops fitting when the table grows", () => {
    const s = custom({ wolf: 1, gossip: 1, villager: 3 });
    expect(setupProblem(s, 5)).toBeNull();
    expect(setupProblem(s, 6)).toBe("Need exactly 6 role cards (have 5)");
  });
});

describe("nightSteps", () => {
  it("is the night order, cut to the roles in the deck", () => {
    expect(nightSteps({ wolf: 2, gossip: 1, villager: 3, lamplighter: 1, stray: 1 })).toEqual(["wolf", "lamplighter", "gossip"]);
  });
});

describe("settings", () => {
  it("default to Standard, 4 minutes, 15 s steps", () => {
    expect(parseShortNightSettings(null)).toMatchObject({ preset: "standard", discussMinutes: 4, stepSeconds: 15 });
  });

  it("takes the options and refuses anything else", () => {
    expect(parseShortNightSettings({ discussMinutes: 6, stepSeconds: 10 })).toMatchObject({ discussMinutes: 6, stepSeconds: 10 });
    expect(parseShortNightSettings({ discussMinutes: 7 })).toBeNull();
    expect(parseShortNightSettings({ stepSeconds: 12 })).toBeNull();
    expect(parseShortNightSettings({ preset: "chaos" })).toBeNull();
    expect(parseShortNightSettings({ preset: "custom", "n:wolf": -1 })).toBeNull();
  });

  it("lobby: roles, talking time, night step; Custom adds a count row per role", () => {
    expect(shortNightSettingFields(null, 6).map((f) => f.key)).toEqual(["preset", "discussMinutes", "stepSeconds"]);
    const fields = shortNightSettingFields(custom({ wolf: 2, villager: 4 }), 6);
    expect(fields.map((f) => f.key)).toEqual(["preset", ...ROLES.map((r) => `n:${r.id}`), "discussMinutes", "stepSeconds"]);
  });

  it("the night-step hint adds up the night", () => {
    const step = shortNightSettingFields({ preset: "standard", stepSeconds: 20 }, 6).at(-1)!;
    expect(step.hint).toBe("4 steps, 80 s of night");
  });
});
