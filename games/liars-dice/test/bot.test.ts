import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { liarsDiceBot } from "../server/bot.ts";
import { liarsDiceGame } from "../server/game.ts";
import { isLegalBid } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type Face,
  type LiarsDiceAction,
  type LiarsDicePrivateState,
  type LiarsDicePublicState,
  type LiarsDiceSettings,
} from "../shared/types.ts";

/** Never the slip; the call limit lands at its top, and no bluff or spot-on roll hits. */
const steady = { randomInt: (max: number) => max - 1, chance: () => 0 };
/** Always rolls 0: the slip (a random legal move). */
const zero = { randomInt: () => 0, chance: () => 0 };

function view(
  dice: Face[],
  o: {
    bid?: { quantity: number; face: Face } | null;
    others?: number;
    settings?: Partial<LiarsDiceSettings>;
    turn?: string;
    phase?: "bidding" | "reveal";
    canReady?: boolean;
  } = {},
) {
  const settings = { ...DEFAULT_SETTINGS, ...o.settings };
  const total = dice.length + (o.others ?? 10);
  const bid = o.bid ? { playerId: "o", ...o.bid } : null;
  const mine = (o.turn ?? "me") === "me" && (o.phase ?? "bidding") === "bidding";
  const pub = {
    phase: o.phase ?? "bidding",
    players: [],
    round: 1,
    currentPlayerId: o.phase === "reveal" ? null : (o.turn ?? "me"),
    totalDice: total,
    bid,
    history: [],
    settings,
  } as unknown as LiarsDicePublicState;
  const priv: LiarsDicePrivateState = {
    dice,
    canBid: mine,
    canCallLiar: mine && !!bid,
    canSpotOn: mine && !!bid && settings.spotOn,
    canReady: o.canReady ?? false,
  };
  return { playerId: "me", public: pub, private: priv };
}

describe("liarsDiceBot", () => {
  it("calls a bid that cannot be true", () => {
    // 11 sixes of 11 dice, with no sixes or 1s in my cup: it cannot be true. Then 5 sixes of 5 dice, the same.
    const v = view([2, 3, 4], { others: 8, bid: { quantity: 11, face: 6 } });
    expect(liarsDiceBot.decide(v, steady)).toEqual({ type: "liar" });
    const impossible = view([2, 3, 4], { others: 2, bid: { quantity: 5, face: 6 } });
    expect(liarsDiceBot.decide(impossible, steady)).toEqual({ type: "liar" });
  });

  it("raises on the face it holds most of, at the least quantity", () => {
    const v = view([5, 5, 5, 2, 3], { others: 5, bid: { quantity: 2, face: 4 } });
    expect(liarsDiceBot.decide(v, steady)).toEqual({ type: "bid", quantity: 2, face: 5 });
  });

  it("opens one under what it expects, at least one, and never on wild 1s", () => {
    const v = view([6, 6, 6, 1, 1], { others: 5 });
    const m = liarsDiceBot.decide(v, steady) as { type: "bid"; quantity: number; face: Face };
    expect(m.face).toBe(6);
    expect(m.quantity).toBe(Math.round(5 + 5 / 3) - 1);
    const low = view([2], { others: 1 });
    expect(liarsDiceBot.decide(low, steady)).toMatchObject({ type: "bid", quantity: 1 });
    const ones = view([1, 1, 1, 1], { others: 2 });
    expect(liarsDiceBot.decide(ones, steady)).toMatchObject({ type: "bid" });
    expect((liarsDiceBot.decide(ones, steady) as { face: Face }).face).not.toBe(1);
  });

  it("calls spot on only when allowed", () => {
    // 1 die of mine (a 2) plus 3 unknown at 1/3: exactly one more 2 is about 0.44, over the 0.3 floor.
    const v = view([2], { others: 3, bid: { quantity: 2, face: 2 } });
    const roll0 = { randomInt: (m: number) => (m === 4 ? 0 : m - 1), chance: () => 0 };
    expect(liarsDiceBot.decide(v, roll0)).toEqual({ type: "spot-on" });
    const off = view([2], { others: 3, bid: { quantity: 2, face: 2 }, settings: { spotOn: false } });
    expect(liarsDiceBot.decide(off, roll0)).not.toEqual({ type: "spot-on" });
  });

  it("taps ready only when allowed, and does nothing off turn", () => {
    expect(liarsDiceBot.decide(view([1], { phase: "reveal", canReady: true }), steady)).toEqual({ type: "ready" });
    expect(liarsDiceBot.decide(view([1], { phase: "reveal", canReady: false }), steady)).toBeNull();
    expect(liarsDiceBot.decide(view([1, 2], { turn: "o", bid: { quantity: 1, face: 2 } }), steady)).toBeNull();
  });

  it("only returns legal bids, with wild ones on or off, including the slip", () => {
    for (const wildOnes of [true, false]) {
      for (let q = 1; q <= 9; q++) {
        for (const face of [1, 2, 3, 4, 5, 6] as Face[]) {
          for (const dice of [[1, 1, 3], [6, 6, 2], [4, 5, 1]] as Face[][]) {
            const v = view(dice, { others: 6, bid: { quantity: q, face }, settings: { wildOnes } });
            for (const ctx of [steady, zero]) {
              const m = liarsDiceBot.decide(v, ctx) as LiarsDiceAction;
              expect(m).not.toBeNull();
              if (m.type === "bid") expect(isLegalBid(v.public.bid, m, wildOnes, v.public.totalDice)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("calls when no bid can beat the standing one", () => {
    const v = view([2, 3], { others: 1, bid: { quantity: 3, face: 6 } });
    v.private.canBid = false;
    expect(liarsDiceBot.decide(v, steady)).toEqual({ type: "liar" });
  });
});

describe("liarsDiceBot all-bot games", () => {
  const extras: [string, Partial<LiarsDiceSettings>][] = [
    ["wild ones off", { wildOnes: false }],
    ["spot on off", { spotOn: false }],
    ["3 starting dice", { startingDice: 3 }],
  ];
  const check = (players: number, name: string, s: Partial<LiarsDiceSettings>, seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const run = playBots(liarsDiceGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s } });
      const at = `${name} seed ${seed}, ${players} players`;
      expect(run.rejected, at).toEqual([]);
      expect(run.stuck, at).toEqual([]);
      expect(run.outcome, at).not.toBeNull();
      expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    }
  };
  const m = liarsDiceGame.manifest;
  const sizes = [...new Set([m.minPlayers, m.bestMinPlayers ?? m.minPlayers, Math.min(m.maxPlayers, 7)])];
  it.each(sizes)("games finish with %i players", (players) => {
    check(players, "defaults", {}, 200);
    for (const [name, s] of extras) check(players, name, s, 50);
  }, 60_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 50; seed++) moves += playBots(liarsDiceGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
