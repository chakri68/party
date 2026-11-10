import { seededRandomInt } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/types.ts";
import { layoutFor } from "../client/layout-cache.ts";
import { treasureHuntGame as th } from "../server/game.ts";
import { makeHunt } from "../server/hunt.ts";
import { generateLayout } from "../shared/generate.ts";

// 298 rerolls (makeHunt lands on a later seed); the rest are spread out.
const SEEDS = [298, ...Array.from({ length: 19 }, (_, i) => 1000 + i * 7919)];

describe("seed-only public state", () => {
  it("rebuilds the hunt's layout from its final seed", () => {
    let rerolled = 0;
    for (const s of SEEDS) {
      const { layout } = makeHunt(s);
      if (layout.seed !== s) rerolled++;
      expect(generateLayout(layout.seed)).toEqual(layout);
    }
    expect(rerolled).toBeGreaterThan(0);
  });

  it("keeps public state small with 8 players", () => {
    const ctx = { now: 1000, randomInt: seededRandomInt(7), hostId: "p0" };
    const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }));
    const t = th.createGame(players, { ...DEFAULT_SETTINGS, minutes: 30 }, { roundNumber: 1, dealerSeat: 0 }, ctx);
    expect(JSON.stringify(th.getPublicState(t.state)).length).toBeLessThan(4000);
  });

  it("memoises layoutFor", () => {
    const s = SEEDS[0]!;
    expect(layoutFor(s)).toBe(layoutFor(s));
    expect(layoutFor(s)).toEqual(generateLayout(s));
  });
});
