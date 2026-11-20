import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { crazyEightsBot } from "../server/bot.ts";
import { crazyEightsGame } from "../server/game.ts";
import { parseCardId } from "../shared/rules.ts";
import type { CrazyEightsPublicState, Suit } from "../shared/types.ts";

/** Never takes the random move: `randomInt` always answers 1. */
const steady = { randomInt: () => 1, chance: () => 0 };

/** A view for "me", with `top` on the pile. Playable cards come from the rules, like the server. */
function view(hand: string[], opts: { top?: string; calledSuit?: Suit | null; turn?: string; canDraw?: boolean } = {}) {
  const top = parseCardId(opts.top ?? "hearts-5")!;
  const cards = hand.map((id) => parseCardId(id)!);
  const calledSuit = opts.calledSuit ?? null;
  const activeSuit = calledSuit ?? top.suit;
  const playableCardIds = cards
    .filter((c) => c.rank === 8 || c.suit === activeSuit || c.rank === top.rank)
    .map((c) => c.id);
  const pub: CrazyEightsPublicState = {
    players: [
      { id: "me", cardCount: cards.length, removed: false },
      { id: "other", cardCount: 5, removed: false },
    ],
    topCard: top,
    calledSuit,
    activeSuit,
    stockCount: 10,
    reshuffleCount: 0,
    currentPlayerId: opts.turn ?? "me",
    dealerId: "other",
    winnerIds: [],
    endReason: null,
  };
  return { playerId: "me", public: pub, private: { hand: cards, playableCardIds, canDraw: opts.canDraw ?? true } };
}

describe("crazyEightsBot", () => {
  it("plays a matching non-8 before an 8", () => {
    const move = crazyEightsBot.decide(view(["clubs-8", "hearts-2", "spades-K"]), steady);
    expect(move).toEqual({ type: "play-card", cardId: "hearts-2" });
  });

  it("prefers the suit it holds most, then the higher rank", () => {
    // hearts-5 on top: hearts-3 (one heart) or spades-5 (three spades). Spades win.
    const move = crazyEightsBot.decide(view(["hearts-3", "spades-5", "spades-2", "spades-J", "clubs-5"]), steady);
    expect(move).toEqual({ type: "play-card", cardId: "spades-5" });
    const high = crazyEightsBot.decide(view(["hearts-3", "hearts-Q", "clubs-2"]), steady);
    expect(high).toEqual({ type: "play-card", cardId: "hearts-Q" });
  });

  it("calls the suit it holds most", () => {
    const move = crazyEightsBot.decide(
      view(["clubs-8", "spades-8", "diamonds-2", "diamonds-9", "spades-3"], { top: "hearts-5" }),
      steady,
    );
    expect(move).toEqual({ type: "play-card", cardId: "clubs-8", suit: "diamonds" });
  });

  it("calls a suit even when it holds only 8s", () => {
    const move = crazyEightsBot.decide(view(["clubs-8"]), steady);
    expect(move).toMatchObject({ type: "play-card", cardId: "clubs-8" });
    expect(move && move.type === "play-card" && move.suit).toBeTruthy();
  });

  it("draws when nothing plays", () => {
    expect(crazyEightsBot.decide(view(["clubs-2", "spades-K"]), steady)).toEqual({ type: "draw" });
  });

  it("does nothing when nothing plays and it can't draw", () => {
    expect(crazyEightsBot.decide(view(["clubs-2"], { canDraw: false }), steady)).toBeNull();
  });

  it("does nothing when it isn't its turn", () => {
    expect(crazyEightsBot.decide(view(["hearts-2", "clubs-8"], { turn: "other" }), steady)).toBeNull();
    expect(crazyEightsBot.decide(view(["hearts-2"], { turn: "" }), steady)).toBeNull();
  });

  it("sometimes plays a random playable card, and an 8 still calls its best suit", () => {
    // randomInt(8) === 0 takes the random move; the next call picks index 0 of the playable cards.
    const random = { randomInt: () => 0, chance: () => 0 };
    const move = crazyEightsBot.decide(view(["clubs-8", "hearts-2", "spades-3", "spades-4"]), random);
    expect(move).toEqual({ type: "play-card", cardId: "clubs-8", suit: "spades" });
  });

  it.each([2, 4, 7])("all-bot games finish with %i players", (players) => {
    for (const emptyStock of ["pass", "reshuffle"] as const) {
      for (let seed = 1; seed <= 200; seed++) {
        const run = playBots(crazyEightsGame, { players, seed, settings: { decks: "auto", emptyStock } });
        expect(run.rejected, `seed ${seed}, ${emptyStock}`).toEqual([]);
        expect(run.stuck, `seed ${seed}, ${emptyStock}`).toEqual([]);
        expect(run.outcome, `seed ${seed}, ${emptyStock}`).not.toBeNull();
        expect(run.longestRun, `seed ${seed}, ${emptyStock}`).toBeLessThan(BOT_MAX_RUN);
      }
    }
    // 400 games at 7 seats take about 4 s, close to the 5 s default.
  }, 20_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 200; seed++) moves += playBots(crazyEightsGame, { players: 4, seed }).moves;
    const perMove = (performance.now() - start) / moves;
    expect(perMove).toBeLessThan(1);
  });
});
