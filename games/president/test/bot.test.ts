import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { presidentBot } from "../server/bot.ts";
import { presidentGame } from "../server/game.ts";
import { compareCards, parseCardId, playableRanks } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type Card,
  type PresidentPublicState,
  type PresidentSettings,
} from "../shared/types.ts";

/** Never takes the random move, and never holds a power card back (a roll of 9 is out of the 6 in 10). */
const steady = { randomInt: (max: number) => Math.min(max - 1, 9), chance: () => 0 };
/** Always rolls 0: the random move. */
/** No random move, but holds power cards back. */
const holdBack = { randomInt: (max: number) => (max === 8 ? 1 : 0), chance: () => 0 };
const zero = { randomInt: () => 0, chance: () => 0 };

const cards = (ids: string[]): Card[] => ids.map((id) => parseCardId(id)!).sort(compareCards);

function view(
  handIds: string[],
  opts: { top?: string[]; turn?: string; phase?: "playing" | "exchange"; mustGive?: number; matchSkips?: boolean } = {},
) {
  const hand = cards(handIds);
  const top = opts.top ? { playerId: "o", cards: cards(opts.top) } : null;
  const turn = opts.turn ?? "me";
  const phase = opts.phase ?? "playing";
  const myTurn = phase === "playing" && turn === "me";
  const pub = {
    phase,
    round: 1,
    rounds: 3,
    matchSkips: opts.matchSkips ?? false,
    players: [],
    currentPlayerId: phase === "playing" ? turn : null,
    top,
    trickSize: top ? 1 : 0,
    dealerId: "o",
    exchange: [],
    lastRound: null,
    winnerIds: [],
    endReason: null,
  } as unknown as PresidentPublicState;
  return {
    playerId: "me",
    public: pub,
    private: {
      hand,
      playableRanks: myTurn ? playableRanks(hand, top, opts.matchSkips ?? false) : [],
      canPass: myTurn && !!top,
      mustGive: opts.mustGive ?? 0,
      gave: [],
      got: [],
    },
  };
}

const ids = (m: unknown) => (m as { cardIds: string[] }).cardIds;

describe("presidentBot exchange", () => {
  it("gives back its lowest cards", () => {
    const v = view(["clubs-5", "hearts-K", "spades-3", "diamonds-9", "hearts-2"], { phase: "exchange", mustGive: 2 });
    const move = presidentBot.decide(v, steady);
    expect(move).toMatchObject({ type: "give" });
    expect(ids(move).sort()).toEqual(["clubs-5", "spades-3"]);
  });

  it("gives the exact count owed, even a single card", () => {
    const v = view(["clubs-5", "hearts-K", "spades-3"], { phase: "exchange", mustGive: 1 });
    expect(presidentBot.decide(v, steady)).toEqual({ type: "give", cardIds: ["spades-3"] });
  });

  it("answers in the exchange even with the random roll at zero", () => {
    const v = view(["clubs-5", "hearts-K", "spades-3"], { phase: "exchange", mustGive: 2 });
    expect(ids(presidentBot.decide(v, zero))).toHaveLength(2);
  });

  it("does nothing when it owes no cards", () => {
    const v = view(["clubs-5", "hearts-K"], { phase: "exchange", mustGive: 0 });
    expect(presidentBot.decide(v, steady)).toBeNull();
  });
});

describe("presidentBot play", () => {
  it("leads its lowest rank with all copies", () => {
    const v = view(["clubs-4", "hearts-4", "spades-9", "hearts-K", "clubs-J", "hearts-7"]);
    expect(ids(presidentBot.decide(v, steady)).sort()).toEqual(["clubs-4", "hearts-4"]);
  });

  it("keeps Aces and 2s while it holds other cards", () => {
    const v = view(["clubs-A", "hearts-A", "spades-2", "hearts-Q", "clubs-J", "hearts-K"]);
    expect(presidentBot.decide(v, steady)).toEqual({ type: "play", cardIds: ["clubs-J"] });
  });

  it("leads a power card when the hand is small", () => {
    const v = view(["clubs-A", "hearts-A", "spades-2"]);
    expect(ids(presidentBot.decide(v, steady)).sort()).toEqual(["clubs-A", "hearts-A"]);
  });

  it("leads a power card when nothing else is left", () => {
    const v = view(["clubs-A", "hearts-A", "spades-2", "hearts-2", "clubs-2", "diamonds-2"]);
    expect(presidentBot.decide(v, steady)).toMatchObject({ type: "play" });
  });

  it("follows with the lowest rank that beats the pile", () => {
    const v = view(["clubs-5", "hearts-8", "spades-J", "hearts-K"], { top: ["spades-6"] });
    expect(presidentBot.decide(v, steady)).toEqual({ type: "play", cardIds: ["hearts-8"] });
  });

  it("follows a pair with exactly a pair", () => {
    const v = view(["clubs-8", "hearts-8", "diamonds-8", "spades-J", "hearts-J"], { top: ["spades-6", "hearts-6"] });
    expect(ids(presidentBot.decide(v, steady))).toHaveLength(2);
    expect(ids(presidentBot.decide(v, steady)).every((id) => id.endsWith("-8"))).toBe(true);
  });

  it("with matchSkips it may play an equal rank", () => {
    const v = view(["clubs-6", "hearts-9", "spades-J", "hearts-K"], { top: ["spades-6"], matchSkips: true });
    expect(presidentBot.decide(v, steady)).toEqual({ type: "play", cardIds: ["clubs-6"] });
  });

  it("passes rather than spend an Ace with a big hand, most of the time", () => {
    const v = view(["clubs-3", "hearts-4", "spades-5", "hearts-6", "clubs-7", "hearts-A"], { top: ["spades-K"] });
    expect(presidentBot.decide(v, holdBack)).toEqual({ type: "pass" });
    expect(presidentBot.decide(v, steady)).toEqual({ type: "play", cardIds: ["hearts-A"] });
  });

  it("spends an Ace with a small hand", () => {
    const v = view(["clubs-3", "hearts-4", "hearts-A"], { top: ["spades-K"] });
    expect(presidentBot.decide(v, holdBack)).toEqual({
      type: "play",
      cardIds: ["hearts-A"],
    });
  });

  it("plays a random legal set about 1 time in 8", () => {
    const v = view(["clubs-5", "hearts-8", "spades-J", "hearts-K"], { top: ["spades-6"] });
    const last = { randomInt: (max: number) => (max === 8 ? 0 : max - 1), chance: () => 0 };
    expect(presidentBot.decide(v, last)).toEqual({ type: "play", cardIds: ["hearts-K"] });
  });

  it("does nothing when it is not its turn or the game is over", () => {
    expect(presidentBot.decide(view(["clubs-5"], { turn: "o" }), steady)).toBeNull();
    const done = view(["clubs-5"]);
    expect(presidentBot.decide({ ...done, public: { ...done.public, phase: "finished" } }, steady)).toBeNull();
  });
});

describe("presidentBot all-bot games", () => {
  const settings: [string, Partial<PresidentSettings>][] = [
    ["match skips", { matchSkips: true }],
    ["5 rounds", { rounds: 5 }],
    ["1 round", { rounds: 1 }],
  ];
  const check = (players: number, name: string, s: Partial<PresidentSettings>, seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const run = playBots(presidentGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s } });
      const at = `${name} seed ${seed}, ${players} players`;
      expect(run.rejected, at).toEqual([]);
      expect(run.stuck, at).toEqual([]);
      expect(run.outcome, at).not.toBeNull();
      expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    }
  };
  const best = presidentGame.manifest;
  const sizes = [...new Set([best.minPlayers, best.bestMinPlayers ?? best.minPlayers, Math.min(best.maxPlayers, 7)])];
  it.each(sizes)("games finish with %i players", (players) => {
    check(players, "defaults", {}, 200);
    for (const [name, s] of settings) check(players, name, s, 50);
  }, 30_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 50; seed++) moves += playBots(presidentGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
