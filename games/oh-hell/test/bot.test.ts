import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { ohHellBot } from "../server/bot.ts";
import { ohHellGame } from "../server/game.ts";
import { legalPlays } from "../shared/tricks.ts";
import { parseCardId, sortHand } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type OhHellPrivateState, type OhHellPublicState, type TrickPlay } from "../shared/types.ts";

/** Never takes the random move: `randomInt` always answers 1. */
const steady = { randomInt: () => 1, chance: () => 0 };
/** Always takes the random move, and the first legal card. */
const zero = { randomInt: () => 0, chance: () => 0 };

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

function view(
  hand: string[],
  o: {
    trump?: string;
    trick?: [string, string][];
    bid?: number | null;
    tricks?: number;
    forbidden?: number | null;
    handSize?: number;
    mode?: "bid" | "play" | "summary" | "wait";
  } = {},
) {
  const mode = o.mode ?? "play";
  const trump = parseCardId(o.trump ?? "hearts-2")!;
  const trick: TrickPlay[] = (o.trick ?? []).map(([playerId, id]) => ({ playerId, card: parseCardId(id)! }));
  const myHand = sortHand(cards(hand), trump.suit);
  const led = trick.length ? trick[0]!.card.suit : null;
  const pub = {
    phase: mode === "summary" ? "round-summary" : mode === "bid" ? "bidding" : "playing",
    players: [
      { id: "me", bid: o.bid === undefined ? 1 : o.bid, tricks: o.tricks ?? 0, score: 0, cardCount: hand.length, removed: false, ready: false },
      { id: "o1", bid: 1, tricks: 0, score: 0, cardCount: hand.length, removed: false, ready: false },
    ],
    round: 1,
    schedule: [hand.length],
    handSize: o.handSize ?? hand.length,
    dealerId: "o1",
    trump,
    currentPlayerId: mode === "bid" || mode === "play" ? "me" : mode === "wait" ? "o1" : null,
    bidsMade: 0,
    bidsTotal: 0,
    forbiddenBid: o.forbidden ?? null,
    dealerRule: true,
    missing: "zero",
    trick,
    trickWinnerId: null,
    lastTrick: null,
    trickNumber: 1,
    results: null,
    summaryEndsAt: null,
    summaryMs: 5000,
    winnerIds: [],
    endReason: null,
  } as unknown as OhHellPublicState;
  const priv: OhHellPrivateState = {
    hand: myHand,
    legal: mode === "play" ? legalPlays(myHand, led).map((c) => c.id) : [],
    canBid: mode === "bid",
    canReady: mode === "summary",
  };
  return { playerId: "me", public: pub, private: priv };
}

describe("ohHellBot bidding", () => {
  it("counts high trumps and side Aces", () => {
    const v = view(["hearts-A", "hearts-Q", "spades-A", "clubs-4", "clubs-5", "diamonds-3", "diamonds-5"], { mode: "bid", trump: "hearts-2" });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "bid", tricks: 3 });
  });

  it("counts any trump in a small hand", () => {
    const v = view(["hearts-3", "clubs-4"], { mode: "bid", trump: "hearts-2" });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "bid", tricks: 1 });
  });

  it("moves off the forbidden bid", () => {
    const v = view(["hearts-A", "hearts-Q", "spades-A", "clubs-4", "clubs-5"], { mode: "bid", forbidden: 3 });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "bid", tricks: 2 });
    const zeroBid = view(["clubs-4", "clubs-5", "diamonds-3"], { mode: "bid", forbidden: 0 });
    expect(ohHellBot.decide(zeroBid, steady)).toEqual({ type: "bid", tricks: 1 });
  });

  it("never bids the forbidden number or past the hand", () => {
    for (let size = 1; size <= 7; size++) {
      for (let forbidden = 0; forbidden <= size; forbidden++) {
        const hand = ["spades-A", "hearts-A", "clubs-A", "diamonds-A", "hearts-K", "hearts-Q", "hearts-J"].slice(0, size);
        const a = ohHellBot.decide(view(hand, { mode: "bid", forbidden }), steady) as { tricks: number };
        expect(a.tricks).not.toBe(forbidden);
        expect(a.tricks).toBeGreaterThanOrEqual(0);
        expect(a.tricks).toBeLessThanOrEqual(size);
      }
    }
  });
});

describe("ohHellBot play", () => {
  it("leads its highest card when it needs tricks", () => {
    const v = view(["clubs-4", "clubs-K", "spades-9"], { bid: 2, tricks: 0 });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "clubs-K" });
  });

  it("follows with the lowest card that wins when it needs tricks", () => {
    const v = view(["clubs-4", "clubs-9", "clubs-K"], { bid: 2, tricks: 0, trick: [["o1", "clubs-7"]] });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "clubs-9" });
  });

  it("plays its lowest legal card when it cannot win", () => {
    const v = view(["clubs-4", "clubs-5"], { bid: 2, tricks: 0, trick: [["o1", "clubs-9"]] });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "clubs-4" });
  });

  it("ducks when the bid is made", () => {
    const v = view(["clubs-4", "clubs-8", "clubs-K"], { bid: 1, tricks: 1, trick: [["o1", "clubs-9"]] });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "clubs-8" });
  });

  it("plays its highest card when every card wins and the bid is made", () => {
    const v = view(["clubs-10", "clubs-K"], { bid: 0, tricks: 0, trick: [["o1", "clubs-9"]] });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "clubs-K" });
  });

  it("leads its lowest card when the bid is made", () => {
    const v = view(["hearts-3", "clubs-4", "clubs-K"], { bid: 0, tricks: 0 });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "clubs-4" });
  });

  it("follows suit even on a random move", () => {
    const v = view(["spades-3", "clubs-4", "clubs-K"], { trick: [["o1", "clubs-9"]] });
    const a = ohHellBot.decide(v, zero) as { card: string };
    expect(v.private.legal).toContain(a.card);
    expect(a.card.startsWith("clubs")).toBe(true);
  });

  it("trumps in when it is out of the suit and needs the trick", () => {
    const v = view(["hearts-3", "spades-4"], { bid: 1, tricks: 0, trick: [["o1", "clubs-9"]] });
    expect(ohHellBot.decide(v, steady)).toEqual({ type: "play", card: "hearts-3" });
  });
});

describe("ohHellBot waiting", () => {
  it("sends ready only when it can", () => {
    expect(ohHellBot.decide(view(["clubs-4"], { mode: "summary" }), steady)).toEqual({ type: "ready" });
    expect(ohHellBot.decide(view(["clubs-4"], { mode: "wait" }), steady)).toBeNull();
  });

  it("does nothing in the round summary once it can't ready (already ready)", () => {
    const v = view(["clubs-4"], { mode: "summary" });
    v.private.canReady = false;
    expect(v.public.phase).toBe("round-summary");
    expect(ohHellBot.decide(v, steady)).toBeNull();
  });

  it("does nothing while a trick is held", () => {
    const v = view(["clubs-4"], { mode: "wait" });
    (v.public as { currentPlayerId: string | null }).currentPlayerId = null;
    expect(ohHellBot.decide(v, steady)).toBeNull();
  });
});

describe("ohHellBot all-bot games", () => {
  // The largest table is 7 seats, the game's own maximum. A 7-seat game is long, so seeds stay at 200 for default settings.
  it.each([3, 4, 7] as const)("finishes with %i players", (players) => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = playBots(ohHellGame, { players, seed });
      expect(run.rejected, `seed ${seed}`).toEqual([]);
      expect(run.stuck, `seed ${seed}`).toEqual([]);
      expect(run.outcome, `seed ${seed}`).not.toBeNull();
      expect(run.longestRun, `seed ${seed}`).toBeLessThan(BOT_MAX_RUN);
    }
  }, 30_000);

  const variants = [
    { name: "no dealer rule", settings: { dealerRule: false } },
    { name: "difference scoring, down schedule", settings: { missing: "difference", schedule: "down" } },
    { name: "up schedule, biggest max", settings: { schedule: "up", biggest: "max" } },
  ];
  it.each(variants)("finishes with $name", ({ settings }) => {
    for (const players of [3, 5]) {
      for (let seed = 1; seed <= 50; seed++) {
        const run = playBots(ohHellGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...settings } });
        const label = `seed ${seed}, ${players} players`;
        expect(run.rejected, label).toEqual([]);
        expect(run.stuck, label).toEqual([]);
        expect(run.outcome, label).not.toBeNull();
        expect(run.longestRun, label).toBeLessThan(BOT_MAX_RUN);
      }
    }
  }, 30_000);

  // Best of three rounds after a warm-up: load slows a round, never speeds it up. The timeout covers a busy full run.
  it("stays fast", () => {
    playBots(ohHellGame, { players: 4, seed: 101 });
    let best = Infinity;
    for (let round = 0; round < 3; round++) {
      let moves = 0;
      const start = performance.now();
      for (let seed = 1; seed <= 100; seed++) moves += playBots(ohHellGame, { players: 4, seed }).moves;
      best = Math.min(best, (performance.now() - start) / moves);
    }
    expect(best).toBeLessThan(1);
  }, 60_000);
});
