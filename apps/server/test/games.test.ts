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

/**
 * Games with no recap stats yet. Don't add new games here: give them
 * partyStats (see AGENTS.md, "Adding a game: party recap stats"). Taking a
 * game off this list once it has stats is the whole point of it.
 */
const RECAP_EXEMPT = new Set([
  "sevens",
  "crazy-eights",
  "old-maid",
  "go-fish",
  "president",
  "pass-the-bomb",
  "chain-words",
  "dont-say-it",
  "face-off",
  "dominion",
  "short-night",
  "heist",
  "farkle",
  "thorns",
  "oh-hell",
  "holdem",
  "overheat",
  "same-page",
  "blind-rally",
  "rally",
  "treasure-hunt",
]);

describe("party recap stats", () => {
  const all = gamesFor({ blindRally: true, treasureHunt: true });

  it.each(Object.keys(all))("%s reports partyStats, or is on the old exempt list", (id) => {
    const has = typeof all[id]!.partyStats === "function";
    expect(
      has || RECAP_EXEMPT.has(id),
      `${id} has no partyStats. Every new game feeds the party recap: see AGENTS.md, "Adding a game: party recap stats".`,
    ).toBe(true);
  });

  it("doesn't exempt a game that already has stats, or one that's gone", () => {
    for (const id of RECAP_EXEMPT) {
      expect(all, `${id} is exempt but isn't registered`).toHaveProperty(id);
      expect(typeof all[id]!.partyStats, `${id} has partyStats now: take it off RECAP_EXEMPT`).not.toBe("function");
    }
  });
});
