import { describe, expect, it } from "vitest";
import { dominionSettingFields } from "../shared/rules-text.ts";

const field = (raw: unknown, players: number, key: string) => dominionSettingFields(raw, players).find((f) => f.key === key)!;

describe("lobby warnings", () => {
  it("warns when fewer computers fit than were picked", () => {
    expect(field({ bots: 7 }, 2, "bots")).toMatchObject({ hint: "Only 6 fit with 2 people", warn: true });
    expect(field({ bots: 1 }, 2, "bots").warn).toBeUndefined();
  });

  it("warns when the map is too small and a bigger one is used", () => {
    expect(field({ bots: 6, mapSize: 16 }, 2, "mapSize")).toMatchObject({ hint: "Too small for 8. Using 24×24", warn: true });
    expect(field({ mapSize: "auto" }, 2, "mapSize").warn).toBeUndefined();
  });

  it("warns when there are too few players for the teams", () => {
    expect(field({ teams: 4 }, 2, "teams")).toMatchObject({ hint: "Needs at least 4 players", warn: true });
    expect(field({ teams: 0 }, 2, "teams").warn).toBeUndefined();
  });
});
