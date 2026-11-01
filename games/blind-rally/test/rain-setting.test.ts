import { describe, expect, it } from "vitest";
import { upgrade } from "../server/upgrade.ts";
import { parseRallySettings, rallySettingFields } from "../shared/rally.ts";
import { blindRallySettingFields, parseSettings } from "../shared/rules-text.ts";
import { skyPlan, skyWords } from "../shared/sky.ts";
import { trackData } from "../server/geometry.ts";
import { game, newGame, newRally, racing } from "./helpers.ts";

const games = [
  { name: "Blind Rally", parse: parseSettings, fields: blindRallySettingFields },
  { name: "Rally", parse: parseRallySettings, fields: rallySettingFields },
];

for (const g of games) {
  describe(`${g.name}: the Rain setting`, () => {
    it("defaults to dry, keeps a valid value, and refuses a bad one", () => {
      expect(g.parse({})!.rain).toBe("dry");
      expect(g.parse({ rain: "storm" })!.rain).toBe("storm");
      expect(g.parse({ rain: "hail" })).toBeNull();
    });

    it("sits right after Time, with five choices and their hints", () => {
      const fields = g.fields({}, 3);
      const keys = fields.map((f) => f.key);
      expect(keys.indexOf("rain")).toBe(keys.indexOf("time") + 1);
      const rain = fields.find((f) => f.key === "rain")!;
      expect(rain.label).toBe("Rain");
      expect(rain.options.map((o) => o.label)).toEqual(["Dry", "Rain", "Rain starts", "Rain stops", "Random"]);
      const hint = (r: string) => g.fields({ rain: r }, 3).find((f) => f.key === "rain")!.hint;
      expect(hint("dry")).toBe("The road is dry.");
      expect(hint("rain")).toBe("The road is wet. Cars slide more.");
      expect(hint("storm")).toBe("Rain starts while you drive.");
      expect(hint("clears")).toBe("The rain stops and the road dries.");
      expect(hint("random")).toBe("A surprise. Everyone gets the same one.");
    });
  });
}

it("Rally's fields end weather, time, rain", () => {
  expect(rallySettingFields({}, 3).map((f) => f.key).slice(-3)).toEqual(["weather", "time", "rain"]);
});

describe("rooms saved before the Rain setting", () => {
  for (const [name, make] of [["Blind Rally", () => newGame(4)], ["Rally", () => newRally(2)]] as const) {
    it(`${name}: get dry, and nothing else changes`, () => {
      const s = structuredClone(make()) as unknown as { settings: Record<string, unknown> };
      const before = { ...s.settings };
      delete s.settings.rain;
      const up = upgrade(s as never);
      expect(up.settings.rain).toBe("dry");
      expect({ ...up.settings, rain: undefined }).toEqual({ ...before, rain: undefined });
      const now = make();
      expect(upgrade(now)).toBe(now);
    });
  }
});

describe("rain in the projection", () => {
  it("the session's sky and the lobby's words agree on the rain", () => {
    const s = racing([["p0", "p1"]], 2, { rain: "storm" });
    const plan = skyPlan(s.settings.time, "storm", s.seed, trackData(s.trackId));
    const me = game.getPrivateState(s, "p1");
    expect(me.role === "navigator" && me.session.sky.rain).toEqual(plan.rain);
    expect(game.getPublicState(s).skyWords).toBe(skyWords(plan, s.trackId));
    expect(game.getPublicState(s).skyWords).toContain("Rain starts during the run.");
  });

  it("on Snowblind the words say Snow", () => {
    const s = racing([["p0", "p1"]], 2, { rain: "storm" });
    s.trackId = "snowblind" as never;
    expect(game.getPublicState(s).skyWords).toContain("Snow starts during the run.");
  });
});
