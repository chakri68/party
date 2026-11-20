import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { sevensBot } from "../server/bot.ts";
import { sevensGame } from "../server/game.ts";
import { emptyBoard, makeCard, placeCard } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type Card, type SevensPublicState, type SevensSettings, type Suit } from "../shared/types.ts";

/** Never takes the random move. */
const steady = { randomInt: (max: number) => Math.min(1, max - 1), chance: () => 0 };

const c = (suit: Suit, rank: number) => makeCard(suit, rank);

function view(hand: Card[], opts: { placed?: Card[]; canPass?: boolean; turn?: string; playable?: string[] } = {}) {
  let board = emptyBoard(1);
  for (const card of opts.placed ?? []) board = placeCard(board, card).board;
  const pub: SevensPublicState = {
    players: [
      { id: "me", cardCount: hand.length, removed: false },
      { id: "o", cardCount: 5, removed: false },
    ],
    board,
    decks: 1,
    currentPlayerId: opts.turn ?? "me",
    dealerId: "o",
    winnerId: null,
    acePosition: "high",
  };
  const playable = opts.playable ?? hand.map((x) => x.id);
  return { playerId: "me", public: pub, private: { hand, playableCardIds: playable, canPass: opts.canPass ?? false } };
}

const sevens = [c("hearts", 7), c("spades", 7), c("clubs", 7), c("diamonds", 7)];

describe("sevensBot", () => {
  it("plays the card that opens the most of its own cards", () => {
    // Hearts 8 opens 9, 10 and J. Spades 8 opens only 9.
    const hand = [c("hearts", 8), c("hearts", 9), c("hearts", 10), c("hearts", 11), c("spades", 8), c("spades", 9)];
    const move = sevensBot.decide(view(hand, { placed: sevens, playable: ["hearts-8", "spades-8"] }), steady);
    expect(move).toEqual({ type: "play-card", cardId: "hearts-8" });
  });

  it("breaks ties by the farthest own card", () => {
    // Both 8s open two cards; the spades run reaches the King.
    const hand = [c("hearts", 8), c("hearts", 9), c("hearts", 10), c("spades", 8), c("spades", 9), c("spades", 13)];
    const move = sevensBot.decide(view(hand, { placed: sevens, playable: ["hearts-8", "spades-8"] }), steady);
    expect(move).toEqual({ type: "play-card", cardId: "spades-8" });
  });

  it("counts cards below the seven for low cards", () => {
    const hand = [c("hearts", 6), c("hearts", 3), c("hearts", 2), c("spades", 8), c("spades", 9)];
    const move = sevensBot.decide(view(hand, { placed: sevens, playable: ["hearts-6", "spades-8"] }), steady);
    expect(move).toEqual({ type: "play-card", cardId: "hearts-6" });
  });

  it("opens a suit with its own seven when that unlocks both sides", () => {
    const hand = [c("hearts", 7), c("hearts", 6), c("hearts", 8), c("clubs", 7)];
    const move = sevensBot.decide(view(hand, { playable: ["hearts-7", "clubs-7"] }), steady);
    expect(move).toEqual({ type: "play-card", cardId: "hearts-7" });
  });

  it("plays a random playable card about 1 time in 8", () => {
    const hand = [c("hearts", 8), c("hearts", 9), c("spades", 8)];
    const v = view(hand, { placed: sevens, playable: ["hearts-8", "spades-8"] });
    const ctx = { randomInt: () => 0, chance: () => 0 };
    expect(sevensBot.decide(v, ctx)).toEqual({ type: "play-card", cardId: "hearts-8" });
    const last = { randomInt: (max: number) => (max === 8 ? 0 : max - 1), chance: () => 0 };
    expect(sevensBot.decide(v, last)).toEqual({ type: "play-card", cardId: "spades-8" });
  });

  it("scores aces high and low", () => {
    // Aces high: the Ace (14) lies above the 8 and 9. Aces low: the Ace (1) lies below the 6.
    const high = [c("hearts", 8), c("hearts", 14), c("spades", 8), c("spades", 9)];
    expect(sevensBot.decide(view(high, { placed: sevens, playable: ["hearts-8", "spades-8"] }), steady)).toEqual({
      type: "play-card",
      cardId: "hearts-8",
    }); // reaches 6 above, ties the count, farther than the 9
    const low = [c("hearts", 6), c("hearts", 1), c("spades", 6), c("spades", 5)];
    expect(sevensBot.decide(view(low, { placed: sevens, playable: ["hearts-6", "spades-6"] }), steady)).toEqual({
      type: "play-card",
      cardId: "hearts-6",
    });
  });

  it("plays one of two identical copies", () => {
    const hand = [makeCard("hearts", 8), makeCard("hearts", 8, 1), c("hearts", 9)];
    const move = sevensBot.decide(view(hand, { placed: sevens, playable: ["hearts-8", "hearts-8~1"] }), steady);
    expect(["hearts-8", "hearts-8~1"]).toContain((move as { cardId: string }).cardId);
  });

  it("does not count another seven as opened by a seven", () => {
    const hand = [c("spades", 7), makeCard("hearts", 7), makeCard("hearts", 7, 1)];
    const v = view(hand, { playable: ["hearts-7", "spades-7"] });
    expect(sevensBot.decide(v, steady)).toEqual({ type: "play-card", cardId: "spades-7" });
  });

  it("never passes while holding a playable card, even when passing is allowed", () => {
    const hand = [c("hearts", 8), c("spades", 2)];
    const v = view(hand, { placed: sevens, canPass: true, playable: ["hearts-8"] });
    for (let i = 0; i < 20; i++) {
      const ctx = { randomInt: (max: number) => i % max, chance: () => 0 };
      expect(sevensBot.decide(v, ctx)?.type).toBe("play-card");
    }
  });

  it("passes when nothing plays and passing is allowed", () => {
    const hand = [c("hearts", 9), c("spades", 2)];
    expect(sevensBot.decide(view(hand, { placed: sevens, canPass: true, playable: [] }), steady)).toEqual({ type: "pass" });
    expect(sevensBot.decide(view(hand, { placed: sevens, canPass: false, playable: [] }), steady)).toBeNull();
  });

  it("does nothing when it isn't its turn or the game is over", () => {
    const hand = [c("hearts", 8)];
    expect(sevensBot.decide(view(hand, { placed: sevens, turn: "o" }), steady)).toBeNull();
    const done = view(hand, { placed: sevens });
    expect(sevensBot.decide({ ...done, public: { ...done.public, winnerId: "o", currentPlayerId: null } }, steady)).toBeNull();
  });

  const settings: [string, Partial<SevensSettings>][] = [
    ["forced play off", { forcedPlay: false }],
    ["aces low", { acePosition: "low" }],
    ["seven of diamonds first", { startingRule: "seven-of-diamonds" }],
    ["remaining cards", { scoring: "remaining-cards" }],
    ["1 deck", { decks: 1 }],
    ["2 decks", { decks: 2 }],
    ["3 decks", { decks: 3 }],
    ["3 decks, no forced play, seven of diamonds", { decks: 3, forcedPlay: false, startingRule: "seven-of-diamonds" }],
  ];
  const check = (players: number, name: string, s: Partial<SevensSettings>, seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const run = playBots(sevensGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s } });
      const at = `${name} seed ${seed}, ${players} players`;
      expect(run.rejected, at).toEqual([]);
      expect(run.stuck, at).toEqual([]);
      expect(run.outcome, at).not.toBeNull();
      expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    }
  };
  it.each([2, 4, 7])("all-bot games finish with %i players", (players) => {
    check(players, "defaults", {}, 200);
    for (const [name, s] of settings) check(players, name, s, 50);
  }, 30_000);
  it("all-bot games finish with 16 players", () => {
    check(16, "defaults", {}, 50);
    for (const [name, s] of settings.slice(0, 3)) check(16, name, s, 50);
  }, 30_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 50; seed++) moves += playBots(sevensGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
