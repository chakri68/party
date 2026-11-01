import { describe, expect, it } from "vitest";
import { upgrade } from "../server/upgrade.ts";
import { parseRallySettings, rallyPreview, rallySettingFields } from "../shared/rally.ts";
import { blindRallySettingFields, parseSettings, rulesPreview } from "../shared/rules-text.ts";
import { newGame, newRally } from "./helpers.ts";

const games = [
  { name: "Blind Rally", parse: parseSettings, fields: blindRallySettingFields, preview: rulesPreview },
  { name: "Rally", parse: parseRallySettings, fields: rallySettingFields, preview: rallyPreview },
];

for (const g of games) {
  describe(`${g.name}: the Time setting`, () => {
    it("defaults to day, keeps a valid value, and refuses a bad one", () => {
      expect(g.parse({})!.time).toBe("day");
      expect(g.parse({ time: "night" })!.time).toBe("night");
      expect(g.parse({ time: "noon" })).toBeNull();
    });

    it("is a field with the six choices, and Weather is now called Mist", () => {
      const fields = g.fields({}, 3);
      const time = fields.find((f) => f.key === "time")!;
      expect(time.label).toBe("Time");
      expect(time.options.map((o) => o.label)).toEqual(["Day", "Dawn", "Dusk", "Night", "Day into night", "Random"]);
      expect(fields.find((f) => f.key === "weather")!.label).toBe("Mist");
      expect(g.preview({}).map((r) => r.label)).toContain("Mist");
      expect(g.preview({}).map((r) => r.label)).not.toContain("Weather");
    });

    it("hints from the current value", () => {
      const hint = (time: string) => g.fields({ time }, 3).find((f) => f.key === "time")!.hint;
      expect(hint("night")).toBe("It's dark. Your lights show the road ahead.");
      expect(hint("sunset")).toBe("The sun goes down while you drive.");
      expect(hint("random")).toBe("A surprise. Everyone gets the same one.");
      for (const t of ["day", "dawn", "dusk"]) expect(hint(t)).toBe("Everyone gets the same light.");
    });
  });
}

describe("rooms saved before the Time setting", () => {
  for (const [name, make] of [["Blind Rally", () => newGame(4)], ["Rally", () => newRally(2)]] as const) {
    it(`${name}: get day, and nothing else changes`, () => {
      const s = structuredClone(make()) as unknown as { settings: Record<string, unknown> };
      const before = { ...s.settings };
      delete s.settings.time;
      const up = upgrade(s as never);
      expect(up.settings.time).toBe("day");
      expect({ ...up.settings, time: undefined }).toEqual({ ...before, time: undefined });
      s.settings.time = "bogus";
      expect(upgrade(s as never).settings.time).toBe("day");
      const now = make();
      expect(upgrade(now)).toBe(now);
    });
  }
});
