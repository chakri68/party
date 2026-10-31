import { describe, expect, it } from "vitest";
import { discCount, handOf, lostDiscAt } from "../shared/rules.ts";
import { thornsSettingFields } from "../shared/rules-text.ts";

describe("discs", () => {
  it("hand is what you own minus what's on your mat, roses first", () => {
    expect(handOf({ roses: 3, thorn: true, stack: [] })).toEqual(["rose", "rose", "rose", "thorn"]);
    expect(handOf({ roses: 3, thorn: true, stack: ["thorn", "rose"] })).toEqual(["rose", "rose"]);
    expect(handOf({ roses: 2, thorn: false, stack: ["rose"] })).toEqual(["rose"]);
    expect(discCount({ roses: 2, thorn: true })).toBe(3);
  });

  it("a lost disc is picked uniformly over everything owned", () => {
    const owned = { roses: 3, thorn: true };
    expect([0, 1, 2, 3].map((i) => lostDiscAt(owned, i))).toEqual(["rose", "rose", "rose", "thorn"]);
    expect(lostDiscAt({ roses: 0, thorn: true }, 0)).toBe("thorn");
  });
});

describe("settings", () => {
  it("offers 2 or 3 points to win, 2 by default", () => {
    const [field] = thornsSettingFields(null, 4);
    expect(field).toMatchObject({ key: "pointsToWin", selected: 0 });
    expect(field!.options.map((o) => o.patch)).toEqual([{ pointsToWin: 2 }, { pointsToWin: 3 }]);
    expect(thornsSettingFields({ pointsToWin: 3 }, 4)[0]!.selected).toBe(1);
  });
});
