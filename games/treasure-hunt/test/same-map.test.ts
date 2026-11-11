import type { GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { treasureHuntGame as th } from "../server/game.ts";
import { makeHunt } from "../server/hunt.ts";
import { startMinOf } from "../shared/sky.ts";
import { treasureHuntRules, treasureHuntSettingFields } from "../shared/rules-text.ts";
import { DEFAULT_SETTINGS, parseTHSettings } from "../shared/types.ts";

const ctx = (value = 12345): GameContext => ({ now: 1000, randomInt: () => value, hostId: "p0" });
const players = [{ id: "p0" }, { id: "p1" }];
const match = (carry?: unknown) => ({ roundNumber: 2, dealerSeat: 0, carry });
const S = 987654;

describe("same map again", () => {
  it("parses the map setting", () => {
    expect(parseTHSettings({ map: "same" })?.map).toBe("same");
    expect(parseTHSettings({})?.map).toBe("new");
    expect(parseTHSettings({ map: "x" })).toBeNull();
    expect(DEFAULT_SETTINGS.map).toBe("new");
  });

  it("carries the finished layout's seed", () => {
    const s = th.createGame(players, DEFAULT_SETTINGS, match(), ctx()).state;
    expect((th.carryOver!(s) as { seed: number }).seed).toBe(s.layout.seed);
  });

  it("same + carried seed reuses the map", () => {
    const settings = { ...DEFAULT_SETTINGS, map: "same" as const, time: "random" as const };
    const s = th.createGame(players, settings, match({ teams: [], seed: S }), ctx()).state;
    expect(s.layout.seed).toBe(S);
    const fresh = makeHunt(S, { startMin: startMinOf("random", S), minutes: settings.minutes, race: false });
    expect(s.caches.map((c) => [c.id, c.x, c.z])).toEqual(fresh.caches.map((c) => [c.id, c.x, c.z]));
  });

  it("new ignores the carried seed", () => {
    const s = th.createGame(players, DEFAULT_SETTINGS, match({ teams: [], seed: S }), ctx(4242)).state;
    expect(s.layout.seed).toBe(4242);
  });

  it("same without a usable seed falls back to a new map", () => {
    const settings = { ...DEFAULT_SETTINGS, map: "same" as const };
    for (const carry of [undefined, { teams: [] }, { seed: "x" }, { seed: 1.5 }]) {
      expect(th.createGame(players, settings, match(carry), ctx(4242)).state.layout.seed).toBe(4242);
    }
  });

  it("lobby field and rule line", () => {
    const f = treasureHuntSettingFields({ map: "same" }, 2).find((x) => x.key === "map")!;
    expect(f.label).toBe("Map");
    expect(f.options.map((o) => o.label)).toEqual(["New map", "Same map again"]);
    expect(f.selected).toBe(1);
    expect(f.hint).toBe("Uses the map from the last round. If there was none, you get a new map.");
    expect(treasureHuntSettingFields({ map: "new" }, 2).find((x) => x.key === "map")!.hint).toBe("A new map every round.");
    expect(treasureHuntRules).toContain("Map: pick Same map again to play the last round's map one more time.");
  });
});
