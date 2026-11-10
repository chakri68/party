import { describe, expect, it } from "vitest";
import { gamesFor } from "../src/games.ts";

describe("game registry flags", () => {
  it("BLIND_RALLY lists Blind Rally and Rally together, and neither without it", () => {
    const off = gamesFor({ blindRally: false, treasureHunt: false });
    expect(off).not.toHaveProperty("blind-rally");
    expect(off).not.toHaveProperty("rally");
    const on = gamesFor({ blindRally: true, treasureHunt: true });
    expect(on["blind-rally"]!.manifest.id).toBe("blind-rally");
    expect(on.rally!.manifest.id).toBe("rally");
    // Every id is the game's own manifest id: select-game looks them up by it.
    for (const [id, def] of Object.entries(on)) expect(def.manifest.id).toBe(id);
  });

  it("TREASURE_HUNT lists Treasure Hunt, and only with it", () => {
    expect(gamesFor({ blindRally: true, treasureHunt: false })).not.toHaveProperty("treasure-hunt");
    const on = gamesFor({ blindRally: false, treasureHunt: true });
    expect(on["treasure-hunt"]!.manifest.id).toBe("treasure-hunt");
    expect(on).not.toHaveProperty("blind-rally");
  });
});
