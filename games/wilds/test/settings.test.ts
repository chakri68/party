import { describe, expect, it } from "vitest";
import { parseWildsSettings, setupProblem, wildsManifest, wildsRules, wildsSettingFields } from "../shared/index.ts";

describe("wilds settings", () => {
  it("parses settings", () => {
    expect(parseWildsSettings(undefined)).toEqual({ sunLimit: 10, planSeconds: 45 });
    expect(parseWildsSettings({ sunLimit: 8 })).toEqual({ sunLimit: 8, planSeconds: 45 });
    expect(parseWildsSettings({ sunLimit: 9 })).toBeNull();
    expect(parseWildsSettings({ planSeconds: 20 })).toBeNull();
    expect(parseWildsSettings([])).toBeNull();
  });

  it("builds the lobby fields", () => {
    const f = wildsSettingFields({}, 4);
    expect(f.map((x) => x.key)).toEqual(["sunLimit", "planSeconds"]);
    expect(f[0]!.options.map((o) => o.label)).toEqual(["8 (hard)", "10", "12 (easy)"]);
    expect(f[0]!.selected).toBe(1);
    expect(f[0]!.hint).toBe("The sun goes down after 10 rounds.");
    expect(f[1]!.options.map((o) => o.label)).toEqual(["30 s", "45 s", "60 s"]);
    expect(f[1]!.hint).toBe("Time to plan each round.");
  });

  it("has a manifest, rules and no setup problem", () => {
    expect(wildsManifest).toMatchObject({ id: "wilds", name: "The Wilds", minPlayers: 2, maxPlayers: 6 });
    expect(wildsRules).toHaveLength(7);
    expect(setupProblem({ sunLimit: 10, planSeconds: 45 }, 2)).toBeNull();
  });
});
