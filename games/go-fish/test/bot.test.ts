import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { goFishBot } from "../server/bot.ts";
import { goFishGame } from "../server/game.ts";
import type { AskRecord, Card, GoFishPublicState, Rank } from "../shared/types.ts";

/** Never forgets, always picks the first choice. */
const steady = { randomInt: (max: number) => Math.min(1, max - 1), chance: () => 0 };
const forgetful = { randomInt: () => 0, chance: () => 0 };

function card(rank: Rank, suit: Card["suit"] = "spades"): Card {
  return { id: `${suit}-${rank}`, suit, rank };
}

function ask(playerId: string, targetId: string, rank: Rank, got: number): AskRecord {
  return { playerId, targetId, rank, got, outcome: got ? "given" : "fished" };
}

function view(opts: { hand?: Rank[]; asks?: AskRecord[]; turn?: string | null; askable?: Rank[] } = {}) {
  const hand = (opts.hand ?? [5, 5, 9]).map((r, i) => card(r, (["spades", "hearts", "clubs"] as const)[i % 3]));
  const pub: GoFishPublicState = {
    players: ["me", "a", "b", "c"].map((id) => ({ id, cardCount: 4, books: [], removed: false, out: false })),
    currentPlayerId: opts.turn === undefined ? "me" : opts.turn,
    dealerId: "me",
    pondCount: 20,
    asks: opts.asks ?? [],
    lastBook: null,
    booksDown: 0,
    winnerIds: [],
    endReason: null,
  };
  const askable = opts.askable ?? [...new Set(hand.map((c) => c.rank))];
  return { playerId: "me", public: pub, private: { hand, askableRanks: opts.turn === undefined || opts.turn === "me" ? askable : [] } };
}

describe("goFishBot", () => {
  it("asks someone who recently asked for a rank it holds", () => {
    const move = goFishBot.decide(view({ asks: [ask("c", "a", 9, 0)] }), steady);
    expect(move).toEqual({ type: "ask", targetId: "c", rank: 9 });
  });

  it("does not use an ask whose cards were taken since", () => {
    const asks = [ask("c", "a", 9, 0), ask("b", "c", 9, 1)];
    const move = goFishBot.decide(view({ asks }), steady);
    expect(move).toEqual({ type: "ask", targetId: "b", rank: 9 });
  });

  it("asks for the rank it holds most of, and avoids a known go fish", () => {
    // "c" said go fish to someone for 5. Always taking the last pick would choose "c" without memory.
    const last = { randomInt: (max: number) => (max === 4 ? 1 : max - 1), chance: () => 0 };
    const move = goFishBot.decide(view({ asks: [ask("x", "c", 5, 0)] }), last);
    expect(move).toEqual({ type: "ask", targetId: "b", rank: 5 });
  });

  it("asks anyone when everyone is known to lack the rank", () => {
    const asks = [ask("x", "a", 5, 0), ask("x", "b", 5, 0), ask("x", "c", 5, 0)];
    const move = goFishBot.decide(view({ asks, hand: [5, 5, 5] }), steady);
    expect(move?.rank).toBe(5);
  });

  it("sometimes ignores memory", () => {
    const move = goFishBot.decide(view({ asks: [ask("c", "a", 9, 0)] }), forgetful);
    expect(move).toEqual({ type: "ask", targetId: "a", rank: 5 });
  });

  it("only asks for ranks in askableRanks, of live players with cards", () => {
    for (let seed = 0; seed < 60; seed++) {
      const ctx = { randomInt: (max: number) => (seed * 7 + max) % max, chance: () => 0 };
      const v = view({ hand: [3, 3, 8], asks: [ask("a", "b", 8, 0), ask("b", "a", 3, 1)], askable: [3, 8] });
      v.public.players[2]!.cardCount = 0;
      const move = goFishBot.decide(v, ctx)!;
      expect([3, 8]).toContain(move.rank);
      expect(["a", "c"]).toContain(move.targetId);
    }
  });

  it("does nothing when it isn't its turn", () => {
    expect(goFishBot.decide(view({ turn: "a" }), steady)).toBeNull();
    expect(goFishBot.decide(view({ turn: null }), steady)).toBeNull();
  });

  it.each([2, 3, 6])("all-bot games finish with %i players", (players) => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = playBots(goFishGame, { players, seed });
      expect(run.rejected, `seed ${seed}`).toEqual([]);
      expect(run.stuck, `seed ${seed}`).toEqual([]);
      expect(run.outcome, `seed ${seed}`).not.toBeNull();
      expect(run.longestRun, `seed ${seed}`).toBeLessThan(BOT_MAX_RUN);
    }
  }, 30_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 200; seed++) moves += playBots(goFishGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(1);
  });
});
