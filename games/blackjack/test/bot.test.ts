import { BOT_MAX_RUN, seededRandomInt } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { basicStrategy, blackjackBot, botBet } from "../server/bot.ts";
import { blackjackGame as bj } from "../server/game.ts";
import { parseCardId } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type BlackjackSettings } from "../shared/types.ts";

const c = (id: string) => parseCardId(id)!;
const play = (mine: string[], up: string, canSplit = true) => basicStrategy(mine.map(c), c(up), canSplit);

describe("basic strategy", () => {
  it("hard totals", () => {
    expect(play(["hearts-10", "spades-6"], "clubs-7")).toBe("H");
    expect(play(["hearts-10", "spades-6"], "clubs-6")).toBe("S");
    expect(play(["hearts-10", "spades-2"], "clubs-3")).toBe("H");
    expect(play(["hearts-10", "spades-2"], "clubs-4")).toBe("S");
    expect(play(["hearts-6", "spades-5"], "clubs-10")).toBe("D");
    // The dealer stands on soft 17: 11 against an Ace is a hit.
    expect(play(["hearts-6", "spades-5"], "clubs-A")).toBe("H");
    expect(play(["hearts-6", "spades-4"], "clubs-10")).toBe("H");
    expect(play(["hearts-6", "spades-3"], "clubs-2")).toBe("H");
    expect(play(["hearts-6", "spades-3"], "clubs-3")).toBe("D");
    expect(play(["hearts-10", "spades-7"], "clubs-A")).toBe("S");
    expect(play(["hearts-3", "spades-2"], "clubs-6")).toBe("H");
  });

  it("soft totals", () => {
    expect(play(["hearts-A", "spades-7"], "clubs-2")).toBe("S");
    expect(play(["hearts-A", "spades-7"], "clubs-4")).toBe("d");
    expect(play(["hearts-A", "spades-7"], "clubs-9")).toBe("H");
    expect(play(["hearts-A", "spades-6"], "clubs-3")).toBe("D");
    expect(play(["hearts-A", "spades-2"], "clubs-4")).toBe("H");
    expect(play(["hearts-A", "spades-2"], "clubs-5")).toBe("D");
    expect(play(["hearts-A", "spades-8"], "clubs-6")).toBe("S");
    expect(play(["hearts-A", "spades-2", "clubs-3"], "clubs-10")).toBe("H");
  });

  it("pairs", () => {
    expect(play(["hearts-A", "spades-A"], "clubs-A")).toBe("P");
    expect(play(["hearts-8", "spades-8"], "clubs-10")).toBe("P");
    expect(play(["hearts-K", "spades-K"], "clubs-6")).toBe("S");
    expect(play(["hearts-9", "spades-9"], "clubs-7")).toBe("S");
    expect(play(["hearts-9", "spades-9"], "clubs-8")).toBe("P");
    expect(play(["hearts-5", "spades-5"], "clubs-6")).toBe("D");
    expect(play(["hearts-4", "spades-4"], "clubs-5")).toBe("P");
    expect(play(["hearts-4", "spades-4"], "clubs-4")).toBe("H");
    expect(play(["hearts-2", "spades-2"], "clubs-7")).toBe("P");
    expect(play(["hearts-2", "spades-2"], "clubs-8")).toBe("H");
  });

  it("plays a pair as a total when it can't split", () => {
    expect(play(["hearts-8", "spades-8"], "clubs-10", false)).toBe("H");
    expect(play(["hearts-A", "spades-A"], "clubs-6", false)).toBe("H");
  });
});

describe("bets", () => {
  it("bets 3 to 10 in 100 of the stack, in tens", () => {
    expect(botBet(1000, 10, 0)).toBe(30);
    expect(botBet(1000, 10, 7)).toBe(100);
    expect(botBet(150, 10, 0)).toBe(10);
    expect(botBet(7, 7, 3)).toBe(7);
  });
});

describe("blackjackBot through the game", () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const settings: [string, BlackjackSettings][] = [
    ["default", DEFAULT_SETTINGS],
    ["20 rounds, rebuys", { rounds: 20, rebuys: "one", turnSeconds: 15 }],
  ];

  it.each(settings)("finishes every game cleanly (%s)", (_name, s) => {
    // One seat alone makes every move in a row: about 2.5 a round, so 20 rounds
    // can pass the room's cap. In a room that's a computer playing while every
    // person sits out the whole game; see "one seat alone" below.
    for (const players of s.rounds > 15 ? [2, 5, 7] : [1, 2, 5, 7]) {
      for (const seed of seeds) {
        const r = playBots(bj, { players, seed: seed * 31 + players, settings: s });
        const where = `players ${players}, seed ${seed}`;
        expect(r.outcome, where).not.toBeNull();
        expect(r.rejected, where).toEqual([]);
        expect(r.stuck, where).toEqual([]);
        expect(r.longestRun, where).toBeLessThan(BOT_MAX_RUN);
      }
    }
  });

  it("one seat alone stays under the room's cap for 10 and 15 rounds", () => {
    for (const rounds of [10, 15]) {
      for (const seed of seeds) {
        const r = playBots(bj, { players: 1, seed, settings: { ...DEFAULT_SETTINGS, rounds, rebuys: "one" } });
        expect(r.outcome).not.toBeNull();
        expect(r.longestRun).toBeLessThan(BOT_MAX_RUN);
      }
    }
  });

  it("rebuys when it runs out early", () => {
    // Big bets would need many rounds; force a broke bot straight away.
    const randomInt = seededRandomInt(3);
    const now = 1_000_000;
    let state = bj.createGame([{ id: "p1" }], { ...DEFAULT_SETTINGS, rebuys: "one" }, { roundNumber: 1, dealerSeat: 0 }, { now, randomInt }).state;
    state = { ...state, players: [{ ...state.players[0]!, stack: 0, pendingRebuy: true }] };
    const view = { playerId: "p1", public: bj.getPublicState(state), private: bj.getPrivateState(state, "p1") };
    expect(blackjackBot.decide(view, { randomInt, chance: () => 0 })).toEqual({ type: "rebuy" });
  });

  it("decides well under 5 ms, worst case", () => {
    // Every view a full 7-seat game gives a bot, timed one by one.
    let worst = 0;
    let calls = 0;
    const timed = {
      ...bj,
      bot: {
        decide: (view: Parameters<typeof blackjackBot.decide>[0], ctx: Parameters<typeof blackjackBot.decide>[1]) => {
          const t0 = performance.now();
          const move = blackjackBot.decide(view, ctx);
          worst = Math.max(worst, performance.now() - t0);
          calls++;
          return move;
        },
      },
    };
    for (const seed of [1, 2, 3, 4, 5]) playBots(timed, { players: 7, seed, settings: { ...DEFAULT_SETTINGS, rounds: 20 } });
    expect(calls).toBeGreaterThan(500);
    expect(worst).toBeLessThan(5);
  });
});
