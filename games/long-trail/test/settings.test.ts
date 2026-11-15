import { describe, expect, it } from "vitest";
import { longTrailManifest, longTrailSettingFields, parseLongTrailSettings } from "../shared/index.ts";

describe("long trail settings", () => {
  it("parses settings", () => {
    expect(parseLongTrailSettings(undefined)).toEqual({ setting: "trade-route", length: "normal" });
    expect(parseLongTrailSettings({ length: "epic" })).toEqual({ setting: "trade-route", length: "epic" });
    expect(parseLongTrailSettings({ length: "huge" })).toBeNull();
    expect(parseLongTrailSettings({ setting: "monsoon" })).toBeNull();
    expect(parseLongTrailSettings([])).toBeNull();
  });

  it("builds lobby fields", () => {
    const f = longTrailSettingFields({}, 5);
    expect(f.map((x) => x.key)).toEqual(["setting", "length"]);
    expect(f[1]!.options.map((o) => o.label)).toEqual(["Short", "Normal", "Epic"]);
    expect(f[1]!.selected).toBe(1);
    expect(f[1]!.hint).toBe("8 stops, about 25 min");
    expect(longTrailSettingFields({ length: "short" }, 5)[1]!.hint).toBe("5 stops, about 15 min");
    expect(longTrailSettingFields({ length: "epic" }, 5)[1]!.hint).toBe("12 stops, about 45 min");
  });

  it("has a manifest", () => {
    expect(longTrailManifest).toMatchObject({ id: "long-trail", minPlayers: 3, maxPlayers: 8 });
  });
});
