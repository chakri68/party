import { describe, expect, it } from "vitest";
import {
  countKey,
  deckFor,
  deckProblem,
  deckSettingFields,
  parseDeckSettings,
  type DeckRules,
  type DeckSettings,
  type Preset,
  type RoleSpec,
} from "../src/index.ts";

const ROLES: RoleSpec[] = [
  { id: "wolf", label: "Werewolf", team: "wolves", max: 3 },
  { id: "seer", label: "Seer", team: "village", max: 1 },
  { id: "guard", label: "Guardian", team: "village", max: 1 },
  { id: "villager", label: "Villager", team: "village", max: 12 },
];

/** Two spare cards, the way a center-card game deals. */
const RULES: DeckRules = { size: (n) => n + 2, requireTeams: ["wolves", "village"] };

const wolvesFor = (n: number) => (n >= 9 ? 3 : n >= 6 ? 2 : 1);
const PRESETS: Preset[] = [
  { id: "beginner", label: "Beginner", deck: (n) => ({ wolf: wolvesFor(n), seer: 1, villager: n + 2 - wolvesFor(n) - 1 }) },
  { id: "standard", label: "Standard", deck: (n) => ({ wolf: wolvesFor(n), seer: 1, guard: 1, villager: n + 2 - wolvesFor(n) - 2 }) },
];

const custom = (counts: Partial<Record<string, number>>): DeckSettings => ({
  preset: "custom",
  ...Object.fromEntries(ROLES.map((r) => [countKey(r.id), counts[r.id] ?? 0])),
});

describe("deckProblem", () => {
  it("wants exactly the rules' size", () => {
    expect(deckProblem({ wolf: 2, seer: 1, villager: 4 }, ROLES, RULES, 6)).toBe("Need exactly 8 role cards (have 7)");
  });

  it("says a one-of role is unique, and caps the rest by count", () => {
    expect(deckProblem({ wolf: 2, seer: 2, villager: 4 }, ROLES, RULES, 6)).toBe("Seer is unique");
    expect(deckProblem({ wolf: 4, seer: 1, villager: 3 }, ROLES, RULES, 6)).toBe("At most 3 Werewolf");
  });

  it("wants a card from every required team, named after its first role", () => {
    expect(deckProblem({ seer: 1, villager: 7 }, ROLES, RULES, 6)).toBe("Needs at least one Werewolf team card");
  });

  it("names a missing team by its label when the rules give one, falling back per team", () => {
    const labelled: DeckRules = { ...RULES, teamLabels: { village: "Village" } };
    expect(deckProblem({ wolf: 3 }, ROLES, labelled, 1)).toBe("Needs at least one Village card");
    // No label for wolves: still named after its first role.
    expect(deckProblem({ seer: 1, villager: 7 }, ROLES, labelled, 6)).toBe("Needs at least one Werewolf team card");
  });

  it("is null for a deck that fits", () => {
    expect(deckProblem({ wolf: 2, seer: 1, villager: 5 }, ROLES, RULES, 6)).toBeNull();
  });

  it("a custom deck that fit goes wrong when the table grows", () => {
    const settings = custom({ wolf: 1, seer: 1, villager: 5 });
    expect(deckProblem(deckFor(settings, ROLES, PRESETS, 5), ROLES, RULES, 5)).toBeNull();
    expect(deckProblem(deckFor(settings, ROLES, PRESETS, 6), ROLES, RULES, 6)).toBe("Need exactly 8 role cards (have 7)");
  });
});

describe("presets", () => {
  it("every preset fits every table from 3 to 12", () => {
    for (const p of PRESETS) {
      for (let n = 3; n <= 12; n++) {
        expect(deckProblem(deckFor({ preset: p.id }, ROLES, PRESETS, n), ROLES, RULES, n), `${p.id} at ${n}`).toBeNull();
      }
    }
  });

  it("ignores stored counts while a preset is picked", () => {
    const settings: DeckSettings = { ...custom({ wolf: 3 }), preset: "standard" };
    expect(deckFor(settings, ROLES, PRESETS, 6)).toEqual(PRESETS[1]!.deck(6));
  });
});

describe("deckSettingFields", () => {
  it("with a preset, one row that lists the deck", () => {
    const fields = deckSettingFields({ preset: "beginner" }, ROLES, PRESETS, RULES, 4);
    expect(fields).toHaveLength(1);
    const [row] = fields;
    expect(row!.key).toBe("preset");
    expect(row!.options.map((o) => o.label)).toEqual(["Beginner", "Standard", "Custom"]);
    expect(row!.selected).toBe(0);
    expect(row!.hint).toBe("1 Werewolf, 1 Seer, 4 Villager");
  });

  it("switching to Custom carries the preset's deck at this head count", () => {
    const [row] = deckSettingFields({ preset: "standard" }, ROLES, PRESETS, RULES, 6);
    expect(row!.options.at(-1)!.patch).toEqual({ preset: "custom", "n:wolf": 2, "n:seer": 1, "n:guard": 1, "n:villager": 4 });
  });

  it("with Custom, a count row per role whose every patch names only its own key", () => {
    const fields = deckSettingFields(custom({ wolf: 2, seer: 1, villager: 5 }), ROLES, PRESETS, RULES, 6);
    expect(fields.map((f) => f.key)).toEqual(["preset", "n:wolf", "n:seer", "n:guard", "n:villager"]);
    expect(fields[0]!.selected).toBe(2);
    expect(fields[0]!.hint).toBe("2 Werewolf, 1 Seer, 5 Villager");

    const wolf = fields[1]!;
    expect(wolf.label).toBe("Werewolf");
    expect(wolf.selected).toBe(2);
    expect(wolf.options.map((o) => o.label)).toEqual(["0", "1", "2", "3"]);
    for (const [k, o] of wolf.options.entries()) expect(o.patch).toEqual({ "n:wolf": k });
    expect(fields[2]!.options).toHaveLength(2); // Seer: 0 or 1
  });

  it("with Custom, the preset row's hint is the problem when there is one", () => {
    const [row] = deckSettingFields(custom({ wolf: 2, seer: 1, villager: 4 }), ROLES, PRESETS, RULES, 6);
    expect(row!.hint).toBe("Need exactly 8 role cards (have 7)");
  });

  it("re-picking Custom while on Custom doesn't resend the counts", () => {
    const [row] = deckSettingFields(custom({ wolf: 2 }), ROLES, PRESETS, RULES, 6);
    expect(row!.options.at(-1)!.patch).toEqual({ preset: "custom" });
  });
});

describe("parseDeckSettings", () => {
  const parse = (input: unknown) => parseDeckSettings(input, ROLES, PRESETS);

  it("keeps the preset and the counts, drops everything else, fills gaps with 0", () => {
    expect(parse({ preset: "custom", "n:wolf": 2, "n:seer": 1, "n:ghost": 4, rounds: 3 })).toEqual({
      preset: "custom",
      "n:wolf": 2,
      "n:seer": 1,
      "n:guard": 0,
      "n:villager": 0,
    });
  });

  it("takes a known preset", () => {
    expect(parse({ preset: "standard" })?.preset).toBe("standard");
  });

  it("refuses unknown presets and bad counts", () => {
    expect(parse({ preset: "chaos" })).toBeNull();
    expect(parse({})).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse({ preset: "custom", "n:wolf": -1 })).toBeNull();
    expect(parse({ preset: "custom", "n:wolf": 1.5 })).toBeNull();
    expect(parse({ preset: "custom", "n:wolf": "2" })).toBeNull();
  });
});
