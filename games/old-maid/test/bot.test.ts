import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { oldMaidBot } from "../server/bot.ts";
import { oldMaidGame } from "../server/game.ts";
import type { OldMaidPublicState } from "../shared/types.ts";

const steady = { randomInt: () => 1, chance: () => 0 };

function view(opts: { turn?: string | null; sourceCount?: number } = {}) {
  const pub: OldMaidPublicState = {
    players: [
      { id: "me", cardCount: 3, removed: false, outPlace: null },
      { id: "other", cardCount: opts.sourceCount ?? 5, removed: false, outPlace: null },
    ],
    currentPlayerId: opts.turn === undefined ? "me" : opts.turn,
    sourceId: "other",
    dealerId: "me",
    discardCount: 0,
    lastPair: null,
    oldMaid: "queen",
    loserId: null,
    loserCard: null,
    endReason: null,
  };
  return { playerId: "me", public: pub, private: { hand: [], canTake: true } };
}

describe("oldMaidBot", () => {
  it("takes a slot inside the source's fan", () => {
    for (let n = 1; n <= 8; n++) {
      for (let r = 0; r < 12; r++) {
        const ctx = { randomInt: (max: number) => r % max, chance: () => 0 };
        const move = oldMaidBot.decide(view({ sourceCount: n }), ctx);
        expect(move?.type).toBe("take");
        const slot = move!.slot;
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(n);
      }
    }
  });

  it("sometimes takes an end slot", () => {
    const first = { randomInt: () => 0, chance: () => 0 };
    expect(oldMaidBot.decide(view({ sourceCount: 5 }), first)).toEqual({ type: "take", slot: 0 });
    const last = { randomInt: (max: number) => (max === 3 ? 0 : 1), chance: () => 0 };
    expect(oldMaidBot.decide(view({ sourceCount: 5 }), last)).toEqual({ type: "take", slot: 4 });
  });

  it("does nothing when it isn't its turn", () => {
    expect(oldMaidBot.decide(view({ turn: "other" }), steady)).toBeNull();
    expect(oldMaidBot.decide(view({ turn: null }), steady)).toBeNull();
  });

  it.each([2, 3, 10])("all-bot games finish with %i players", (players) => {
    for (const oldMaid of ["queen", "joker"] as const) {
      for (let seed = 1; seed <= 200; seed++) {
        const run = playBots(oldMaidGame, { players, seed, settings: { oldMaid } });
        expect(run.rejected, `seed ${seed}, ${oldMaid}`).toEqual([]);
        expect(run.stuck, `seed ${seed}, ${oldMaid}`).toEqual([]);
        expect(run.outcome, `seed ${seed}, ${oldMaid}`).not.toBeNull();
        expect(run.longestRun, `seed ${seed}, ${oldMaid}`).toBeLessThan(BOT_MAX_RUN);
      }
    }
  }, 30_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 200; seed++) moves += playBots(oldMaidGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(1);
  });
});
